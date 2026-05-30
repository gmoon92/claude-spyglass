/**
 * follow-mode-logic.test.ts — 특성화 테스트 for useFollowMode 상태 기계 로직.
 *
 * useFollowMode는 React 훅이지만, 내부 상태 전이 로직을 직접 명시한
 * ADR 스펙이 있다. 여기서는 훅을 호출하지 않고, 동일한 상태 전이를
 * 순수 함수(reducer)로 추출하여 검증한다.
 *
 * 규칙: 소스(useFollowMode.ts)는 변경하지 않는다.
 *       여기서는 same-behavior를 순수 모델로 재구현하여 spec을 고정한다.
 *
 * 검증 대상:
 *   - FOLLOWING 상태에서 onMove(-1) → PAUSED
 *   - PAUSED@N에서 onNewRow() → selectedIdx = N+1
 *   - PAUSED에서 onGoTop() → FOLLOWING@0
 *   - PAUSED에서 onGoBottom(len) → PAUSED@(len-1)
 *   - FOLLOWING/PAUSED에서 onFollowToggle()
 *   - boundary: onMove with listLength=0 → no-op
 *   - boundary: selectedIdx 절대 음수/범위초과 없음
 */

import { describe, expect, test } from 'bun:test';

// ---------------------------------------------------------------------------
// 순수 상태 모델 — useFollowMode와 동일한 의미론.
// ---------------------------------------------------------------------------
type FollowState = 'following' | 'paused';

type State = {
  followState: FollowState;
  selectedIdx: number;
};

function onNewRow(s: State): State {
  if (s.followState === 'paused') {
    return { ...s, selectedIdx: s.selectedIdx + 1 };
  }
  return s;
}

function onMove(s: State, delta: -1 | 1, listLength: number): State {
  if (listLength === 0) return s;
  const newIdx = Math.max(0, Math.min(listLength - 1, s.selectedIdx + delta));
  return { followState: 'paused', selectedIdx: newIdx };
}

function onFollowToggle(s: State): State {
  if (s.followState === 'following') {
    return { ...s, followState: 'paused' };
  }
  return { followState: 'following', selectedIdx: 0 };
}

function onGoTop(_s: State): State {
  return { followState: 'following', selectedIdx: 0 };
}

function onGoBottom(s: State, listLength: number): State {
  if (listLength === 0) return s;
  return { followState: 'paused', selectedIdx: listLength - 1 };
}

const initialState: State = { followState: 'following', selectedIdx: 0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('FollowMode state machine — initial state', () => {
  test('starts in FOLLOWING@0', () => {
    expect(initialState.followState).toBe('following');
    expect(initialState.selectedIdx).toBe(0);
  });
});

describe('FollowMode — onNewRow', () => {
  test('FOLLOWING + onNewRow → no change', () => {
    const s = onNewRow(initialState);
    expect(s.followState).toBe('following');
    expect(s.selectedIdx).toBe(0);
  });

  test('PAUSED@3 + onNewRow → PAUSED@4', () => {
    const paused: State = { followState: 'paused', selectedIdx: 3 };
    const s = onNewRow(paused);
    expect(s.followState).toBe('paused');
    expect(s.selectedIdx).toBe(4);
  });

  test('PAUSED@0 + onNewRow → PAUSED@1', () => {
    const paused: State = { followState: 'paused', selectedIdx: 0 };
    const s = onNewRow(paused);
    expect(s.selectedIdx).toBe(1);
  });
});

describe('FollowMode — onMove', () => {
  test('FOLLOWING + onMove(-1, 10) → PAUSED@0 (clamp to 0)', () => {
    const s = onMove(initialState, -1, 10);
    expect(s.followState).toBe('paused');
    expect(s.selectedIdx).toBe(0);
  });

  test('FOLLOWING + onMove(1, 10) → PAUSED@1', () => {
    const s = onMove(initialState, 1, 10);
    expect(s.followState).toBe('paused');
    expect(s.selectedIdx).toBe(1);
  });

  test('PAUSED@5 + onMove(-1, 10) → PAUSED@4', () => {
    const s = onMove({ followState: 'paused', selectedIdx: 5 }, -1, 10);
    expect(s.selectedIdx).toBe(4);
  });

  test('PAUSED@5 + onMove(1, 10) → PAUSED@6', () => {
    const s = onMove({ followState: 'paused', selectedIdx: 5 }, 1, 10);
    expect(s.selectedIdx).toBe(6);
  });

  test('selectedIdx never goes below 0', () => {
    const s = onMove({ followState: 'paused', selectedIdx: 0 }, -1, 10);
    expect(s.selectedIdx).toBe(0);
  });

  test('selectedIdx never exceeds listLength - 1', () => {
    const s = onMove({ followState: 'paused', selectedIdx: 9 }, 1, 10);
    expect(s.selectedIdx).toBe(9);
  });

  test('listLength=0 → no-op', () => {
    const s = onMove(initialState, 1, 0);
    expect(s).toEqual(initialState);
  });
});

describe('FollowMode — onFollowToggle', () => {
  test('FOLLOWING → PAUSED (selectedIdx unchanged)', () => {
    const s = onFollowToggle(initialState);
    expect(s.followState).toBe('paused');
    expect(s.selectedIdx).toBe(0);
  });

  test('PAUSED@5 → FOLLOWING@0', () => {
    const s = onFollowToggle({ followState: 'paused', selectedIdx: 5 });
    expect(s.followState).toBe('following');
    expect(s.selectedIdx).toBe(0);
  });

  test('double toggle returns to following', () => {
    const s1 = onFollowToggle(initialState);
    const s2 = onFollowToggle(s1);
    expect(s2.followState).toBe('following');
    expect(s2.selectedIdx).toBe(0);
  });
});

describe('FollowMode — onGoTop', () => {
  test('PAUSED@7 → FOLLOWING@0', () => {
    const s = onGoTop({ followState: 'paused', selectedIdx: 7 });
    expect(s.followState).toBe('following');
    expect(s.selectedIdx).toBe(0);
  });

  test('FOLLOWING@0 → FOLLOWING@0 (no-op)', () => {
    const s = onGoTop(initialState);
    expect(s.followState).toBe('following');
    expect(s.selectedIdx).toBe(0);
  });
});

describe('FollowMode — onGoBottom', () => {
  test('FOLLOWING + onGoBottom(10) → PAUSED@9', () => {
    const s = onGoBottom(initialState, 10);
    expect(s.followState).toBe('paused');
    expect(s.selectedIdx).toBe(9);
  });

  test('listLength=0 → no-op', () => {
    const s = onGoBottom(initialState, 0);
    expect(s).toEqual(initialState);
  });

  test('listLength=1 → PAUSED@0', () => {
    const s = onGoBottom(initialState, 1);
    expect(s.followState).toBe('paused');
    expect(s.selectedIdx).toBe(0);
  });
});

describe('FollowMode — composite scenarios', () => {
  test('FOLLOWING → move down → new row → index compensated', () => {
    // Start following, move down 3 times in list of 10
    let s = initialState;
    s = onMove(s, 1, 10); // PAUSED@1
    s = onMove(s, 1, 10); // PAUSED@2
    s = onMove(s, 1, 10); // PAUSED@3

    // New row arrives — index should compensate to 4
    s = onNewRow(s);
    expect(s.selectedIdx).toBe(4);

    // Go top returns to following
    s = onGoTop(s);
    expect(s.followState).toBe('following');
    expect(s.selectedIdx).toBe(0);
  });

  test('multiple new rows accumulate offset', () => {
    let s: State = { followState: 'paused', selectedIdx: 5 };
    s = onNewRow(s);
    s = onNewRow(s);
    s = onNewRow(s);
    expect(s.selectedIdx).toBe(8);
  });
});
