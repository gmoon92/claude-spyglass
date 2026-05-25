/**
 * circuit-breaker.ts — 그래프 DB 장애 격리 회로
 *
 * 책임:
 *   Ladybug 호출이 반복적으로 실패할 때 추가 호출을 차단하여 (a) Bun 서버 main loop
 *   가 native binding crash로 죽지 않도록 보호하고, (b) 사용자에게 자동으로 SQLite
 *   path만 노출되도록 한다. SQLite는 회로와 무관하게 항상 응답을 만들 수 있어야 한다.
 *
 * 의존성:
 *   - 없음 (순수 in-process 상태 기계).
 *
 * 호출 흐름:
 *   1) graph API 라우터가 요청마다 `breaker.allowsTraffic()` 체크.
 *   2) Ladybug 호출 성공 시 `breaker.recordSuccess()`, 실패 시 `breaker.recordFailure(err)`.
 *   3) sync worker tick도 동일 회로를 공유 — 회로가 OPEN이면 outbox 폴링도 일시 정지.
 *
 * 상태 기계 (3-state):
 *   CLOSED      — 정상. 모든 트래픽 통과.
 *   OPEN        — 차단. allowsTraffic() 가 false 반환. cooldown 시간(기본 1h) 경과 후
 *                 자동 HALF_OPEN.
 *   HALF_OPEN   — 1회 시도 허용. 성공이면 CLOSED, 실패면 다시 OPEN.
 *
 * 트리거 조건 (CLOSED → OPEN):
 *   (A) 연속 실패 3회 (CONSECUTIVE_FAILURES_THRESHOLD)
 *   (B) 1시간 sliding window 안에서 fallback rate > 5%
 *
 * 디자인 결정:
 *   - 1개 글로벌 인스턴스(`getCircuitBreaker()`)를 공유 — graph API와 sync worker가
 *     같은 회로 상태를 본다. 분리하면 두 path가 서로 다른 시점에 fallback되어 진단
 *     혼란.
 *   - 상태 전이는 모두 `console.warn` 로그 — 사용자 메모리: 회로 진단 가능성 우선.
 *   - 타이머는 Date.now() 기반 — fake timer (테스트)는 `Date.now` 를 monkey-patch.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/05-migration-strategy.md
 *   §5 L3 자동 회로.
 */

// =============================================================================
// 상수 — 정책 SSoT
// =============================================================================

const CONSECUTIVE_FAILURES_THRESHOLD = 3;
const FALLBACK_RATE_WINDOW_MS = 60 * 60 * 1000; // 1시간
const FALLBACK_RATE_THRESHOLD = 0.05;            // 5%
const OPEN_COOLDOWN_MS = 60 * 60 * 1000;         // 1시간 대기 후 HALF_OPEN

// =============================================================================
// 타입
// =============================================================================

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * sliding window 카운트를 위한 미니 이벤트 — 메모리 절약 위해 timestamp + 성공 여부만
 * 보관. 1시간 window 안에서만 누적되고 자동 청소된다.
 */
interface CallRecord {
  ts: number;
  ok: boolean;
}

// =============================================================================
// 본체
// =============================================================================

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private records: CallRecord[] = [];
  private openedAt: number | null = null;

  /**
   * 회로가 호출을 허용하는지. OPEN 상태이고 cooldown 이 안 지났으면 false,
   * cooldown 이 지났으면 HALF_OPEN 으로 전이하고 true(시범 호출 1회) 반환.
   */
  allowsTraffic(): boolean {
    this.tickIfReadyForHalfOpen();
    return this.state !== 'OPEN';
  }

  /** Ladybug 호출 성공 — 카운터 리셋, HALF_OPEN 이면 CLOSED 복귀. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.pushRecord(true);
    if (this.state === 'HALF_OPEN') {
      this.transition('CLOSED', 'half_open success');
      this.openedAt = null;
    }
  }

  /**
   * Ladybug 호출 실패 — 카운터 증가 + 조건 평가. HALF_OPEN 에서 실패하면 즉시 OPEN으로
   * 복귀(cooldown 재시작).
   */
  recordFailure(error?: unknown): void {
    this.consecutiveFailures++;
    this.pushRecord(false);

    if (this.state === 'HALF_OPEN') {
      this.transition('OPEN', `half_open failure: ${this.errString(error)}`);
      this.openedAt = Date.now();
      return;
    }

    if (this.shouldOpenCircuit()) {
      this.transition('OPEN', this.buildOpenReason(error));
      this.openedAt = Date.now();
    }
  }

  /** 현재 상태 (디버그/모니터링용). */
  getState(): CircuitState {
    return this.state;
  }

  /** 연속 실패 카운터 (테스트 검증용). */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * sliding window 안의 fallback (실패) 비율. 0~1. 1시간 안에 호출이 없으면 0.
   * 테스트 검증용으로도 export 한다.
   */
  getFallbackRate(): number {
    this.evictExpired();
    if (this.records.length === 0) return 0;
    const failures = this.records.filter((r) => !r.ok).length;
    return failures / this.records.length;
  }

  /** 테스트 전용 — 상태 초기화. */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.records = [];
    this.openedAt = null;
  }

  // ---------------------------------------------------------------------------
  // private — 내부 상태 기계
  // ---------------------------------------------------------------------------

  private shouldOpenCircuit(): boolean {
    if (this.consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD) return true;
    if (this.getFallbackRate() > FALLBACK_RATE_THRESHOLD && this.records.length >= 20) {
      // 1시간 안에 최소 20 호출 있어야 비율 신뢰. 적은 표본으로 회로 열지 않는다.
      return true;
    }
    return false;
  }

  private buildOpenReason(error: unknown): string {
    const parts: string[] = [];
    if (this.consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD) {
      parts.push(`consecutive_failures=${this.consecutiveFailures}`);
    }
    const rate = this.getFallbackRate();
    if (rate > FALLBACK_RATE_THRESHOLD) {
      parts.push(`fallback_rate=${(rate * 100).toFixed(1)}%`);
    }
    parts.push(`last_error=${this.errString(error)}`);
    return parts.join(' ');
  }

  /**
   * OPEN 상태에서 cooldown 이 지났으면 HALF_OPEN 으로 전이. 호출자(allowsTraffic) 직전
   * 에 자동 호출되므로 timer 없이도 자연스럽게 회복.
   */
  private tickIfReadyForHalfOpen(): void {
    if (this.state !== 'OPEN') return;
    if (this.openedAt === null) return;
    if (Date.now() - this.openedAt >= OPEN_COOLDOWN_MS) {
      this.transition('HALF_OPEN', 'cooldown elapsed');
    }
  }

  private transition(to: CircuitState, reason: string): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    console.warn(`[graph-circuit] state: ${from} → ${to} (${reason})`);
  }

  private pushRecord(ok: boolean): void {
    this.records.push({ ts: Date.now(), ok });
    this.evictExpired();
  }

  private evictExpired(): void {
    const cutoff = Date.now() - FALLBACK_RATE_WINDOW_MS;
    // sliding window 끝에서 오래된 것 제거 — 정렬되어 push 되므로 앞에서부터.
    let removeUntil = 0;
    while (removeUntil < this.records.length && this.records[removeUntil].ts < cutoff) {
      removeUntil++;
    }
    if (removeUntil > 0) this.records.splice(0, removeUntil);
  }

  private errString(error: unknown): string {
    if (!error) return 'unknown';
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

// =============================================================================
// 글로벌 싱글톤 — graph API + sync worker가 공유
// =============================================================================

let globalBreaker: CircuitBreaker | null = null;

export function getCircuitBreaker(): CircuitBreaker {
  if (!globalBreaker) globalBreaker = new CircuitBreaker();
  return globalBreaker;
}

export function resetCircuitBreaker(): void {
  globalBreaker = null;
}
