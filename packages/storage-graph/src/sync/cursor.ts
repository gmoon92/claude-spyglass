/**
 * cursor.ts — sync worker cursor 상태 영속화
 *
 * 책임:
 *   `~/.spyglass/graph/sync_state.json` 파일에 마지막으로 처리한 outbox id 를 기록한다.
 *   sync worker 가 부팅마다 본 cursor 부터 이어서 처리 — 중복/누락 모두 없다 (outbox
 *   PK 가 단조 증가 + MERGE idempotent).
 *
 * 의존성:
 *   - node:fs (readFile / writeFile)
 *   - runtime/paths (getSyncStatePath)
 *
 * 호출 흐름:
 *   1) worker.startGraphSyncWorker() 가 부팅 시 `getCursor().load()`.
 *   2) 매 tick 종료 시 `cursor.advance(lastId)` — JSON 파일에 flush.
 *   3) 그래프 폴더가 throw-away 된 경우 파일이 사라져 자연스럽게 0 부터 재시작 →
 *      MERGE idempotent 라서 전체 cold rebuild 정상 동작.
 *
 * 디자인 결정:
 *   - JSON 파일 1개 (Bun built-in `writeFileSync`) — DB 도입은 over-engineering.
 *   - 매 advance() 마다 write — 200ms tick × 작은 JSON 이라 부담 없음. crash 시 잃는
 *     건 1 tick 분량.
 *   - tmpfile + rename 패턴으로 원자 쓰기 — 부분 쓰기로 인한 corrupt 방지.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { getSyncStatePath } from '../runtime/paths';

interface SyncStateFile {
  cursor: number;
  updated_at: number;
  bootstrap_completed_at: number | null;
}

const INITIAL_STATE: SyncStateFile = {
  cursor: 0,
  updated_at: 0,
  bootstrap_completed_at: null,
};

/**
 * 커서 + 부트스트랩 메타를 묶어 관리. worker 가 인스턴스 1개를 모든 tick 에서 재사용.
 */
export class SyncCursor {
  private state: SyncStateFile = { ...INITIAL_STATE };
  private path: string = '';
  private loaded = false;

  /** 디스크에서 상태 로드. 파일이 없으면 INITIAL_STATE. */
  load(): void {
    if (this.loaded) return;
    this.path = getSyncStatePath();
    if (existsSync(this.path)) {
      try {
        const raw = readFileSync(this.path, 'utf8');
        const parsed = JSON.parse(raw) as Partial<SyncStateFile>;
        this.state = {
          cursor: typeof parsed.cursor === 'number' ? parsed.cursor : 0,
          updated_at: typeof parsed.updated_at === 'number' ? parsed.updated_at : 0,
          bootstrap_completed_at:
            typeof parsed.bootstrap_completed_at === 'number' ? parsed.bootstrap_completed_at : null,
        };
      } catch (err) {
        // corrupt JSON 은 무시하고 처음부터 — outbox idempotent 라 안전.
        console.warn(`[graph-cursor] failed to parse sync_state.json — restarting from 0: ${err}`);
        this.state = { ...INITIAL_STATE };
      }
    }
    this.loaded = true;
  }

  /** 현재 cursor (마지막으로 처리한 outbox id). 미처리 행은 id > cursor. */
  get current(): number {
    if (!this.loaded) this.load();
    return this.state.cursor;
  }

  /**
   * 커서 전진 + 디스크 flush. lastId 가 현재보다 작거나 같으면 no-op (중복 호출 방어).
   */
  advance(lastId: number): void {
    if (!this.loaded) this.load();
    if (lastId <= this.state.cursor) return;
    this.state.cursor = lastId;
    this.state.updated_at = Date.now();
    this.flush();
  }

  /** cold rebuild 완료 시 1회 호출 — UI 가 graph-ready 토글에 사용. */
  markBootstrapComplete(): void {
    if (!this.loaded) this.load();
    if (this.state.bootstrap_completed_at !== null) return;
    this.state.bootstrap_completed_at = Date.now();
    this.flush();
  }

  /** bootstrap 완료 여부 — API 라우터가 응답에 ready hint 를 실으려면 본 값 참조. */
  isBootstrapComplete(): boolean {
    if (!this.loaded) this.load();
    return this.state.bootstrap_completed_at !== null;
  }

  /** 테스트 전용 — in-memory 만 초기화 (디스크 파일 별도 정리). */
  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.loaded = false;
  }

  // ---------------------------------------------------------------------------
  // private
  // ---------------------------------------------------------------------------

  /** tmpfile + rename 으로 원자 쓰기. 실패는 console.warn — worker 는 계속 동작. */
  private flush(): void {
    try {
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      renameSync(tmp, this.path);
    } catch (err) {
      console.warn(`[graph-cursor] failed to flush sync_state.json: ${err}`);
    }
  }
}

// =============================================================================
// 글로벌 싱글톤 — worker 만 사용
// =============================================================================

let globalCursor: SyncCursor | null = null;

export function getSyncCursor(): SyncCursor {
  if (!globalCursor) globalCursor = new SyncCursor();
  return globalCursor;
}

export function resetSyncCursor(): void {
  globalCursor = null;
}
