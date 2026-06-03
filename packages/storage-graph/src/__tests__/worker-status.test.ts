/**
 * worker-status.test.ts — getSyncWorkerStatus 의 lastSuccessAt 진단 필드.
 *
 * 동기 (architecture-improvement-roadmap §02-5):
 *   /api/graph/status 의 sync 상태만으로는 "지금 멈춘 건지, 원래 큐가 빈 건지"를
 *   구분하려면 cursor 를 두 번 조회해 비교해야 했다. 마지막으로 cursor 가 실제
 *   전진(processed>0)한 시각을 lastSuccessAt 으로 노출해 1회 조회로 판단 가능하게 한다.
 *
 * 의미론:
 *   - lastSuccessAt 은 tick 이 row 를 1건 이상 통과시킨(=cursor 전진) 시각.
 *   - 빈 큐 tick / 전량 실패 tick 은 갱신하지 않는다 (idle ≠ success).
 *   - 부분 성공(poison row 혼재, processed>0) 은 갱신한다 — 시스템은 동작 중.
 *
 * applyTickResult 는 runOutboxTick 과 동일한 "의존성 주입으로 단위 테스트 가능"
 * 철학의 모듈 상태 반영 seam 이다 (now 주입으로 시계 결정론).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getSyncWorkerStatus,
  applyTickResult,
  resetSyncWorkerStateForTests,
} from '../sync/worker';

beforeEach(() => {
  resetSyncWorkerStateForTests();
});

describe('getSyncWorkerStatus — lastSuccessAt', () => {
  it('초기 상태는 null (성공 tick 이 아직 없음)', () => {
    expect(getSyncWorkerStatus().lastSuccessAt).toBeNull();
  });

  it('processed>0 인 tick 결과는 lastSuccessAt 을 주입된 now 로 갱신한다', () => {
    applyTickResult({ processed: 3, error: null }, 1_000_000);
    const s = getSyncWorkerStatus();
    expect(s.lastSuccessAt).toBe(1_000_000);
    expect(s.totalProcessed).toBe(3);
    expect(s.lastError).toBeNull();
  });

  it('processed=0 + error 인 tick(전량 실패/시스템 장애)은 lastSuccessAt 을 갱신하지 않는다', () => {
    applyTickResult({ processed: 2, error: null }, 1_000_000);
    applyTickResult({ processed: 0, error: new Error('ladybug down') }, 2_000_000);
    const s = getSyncWorkerStatus();
    expect(s.lastSuccessAt).toBe(1_000_000); // 동결
    expect(s.lastError).toBe('ladybug down');
  });

  it('부분 성공(poison 혼재, processed>0 + error)은 lastSuccessAt 을 갱신한다', () => {
    applyTickResult({ processed: 5, error: new Error('poison row 41') }, 3_000_000);
    const s = getSyncWorkerStatus();
    expect(s.lastSuccessAt).toBe(3_000_000); // 시스템은 동작 중
    expect(s.lastError).toBe('poison row 41');
    expect(s.totalProcessed).toBe(5);
  });

  it('빈 큐 tick(processed=0, error=null)은 lastSuccessAt 을 갱신하지 않는다 (idle ≠ success)', () => {
    applyTickResult({ processed: 1, error: null }, 4_000_000);
    applyTickResult({ processed: 0, error: null }, 5_000_000);
    expect(getSyncWorkerStatus().lastSuccessAt).toBe(4_000_000);
  });

  it('totalProcessed 는 tick 간 누적된다', () => {
    applyTickResult({ processed: 2, error: null }, 1);
    applyTickResult({ processed: 3, error: null }, 2);
    expect(getSyncWorkerStatus().totalProcessed).toBe(5);
  });
});
