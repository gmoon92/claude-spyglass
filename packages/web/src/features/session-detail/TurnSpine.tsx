/**
 * features/session-detail/TurnSpine.tsx — turn-spine inline-flow (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js
 *  - turnLineHtml (turn-views.js:254) → TurnLine
 *  - renderSpine  (turn-views.js:292) → TurnSpine
 *
 * 책임:
 *  - TurnLine: 한 턴의 inline 컨테이너. 비활성=ds-turn-marker 단일 / 활성=marker + chip-flow.
 *  - TurnSpine: 모든 턴을 turn_index 내림차순(최신 좌측) 정렬해 SpineArrow 로 잇는다.
 *
 * 동치 게이트(P3-06 핵심): exported oracle turnLineHtml/renderSpine 와 renderToStaticMarkup 동치.
 *  활성 턴 TurnLine 이 ChipFlow 전체를 임베드하므로 Chip/ChipFlow/arrows 가 transitive 로 검증된다.
 *
 * @module features/session-detail/TurnSpine
 */
import { Fragment, type ReactElement } from 'react';
import { ChipFlow } from './ChipFlow';
import { SpineArrow } from './Chip';

interface TurnLike {
  turn_id: string;
  turn_index: number;
  prompt?: { preview?: string } | null;
  [k: string]: unknown;
}

/**
 * 한 턴을 turn-spine inline 컨테이너로 렌더. 원본 turnLineHtml(turn-views.js:254) 동치.
 *  - 비활성: 마커 단일. data-turn 은 마커가 아닌 turn-line 에(원본 동일), title=prompt preview.
 *  - 활성: 마커 + .chip-flow(ChipFlow). data-state="active", aria-selected.
 */
export function TurnLine({ turn, isActive }: { turn: TurnLike; isActive: boolean }): ReactElement {
  const indexLabel = `T${turn.turn_index}`;
  const cls = `turn-line${isActive ? ' is-active' : ''}`;
  const ariaSel = isActive ? 'true' : 'false';

  // 마커 — 원본 turn-views.js:262-265. 활성일 때만 data-state="active".
  const marker = (
    <span className="ds-turn-marker" {...(isActive ? { 'data-state': 'active' } : {})}>
      <span className="marker-dot" />
      <span className="marker-index">{indexLabel}</span>
    </span>
  );

  if (!isActive) {
    // 비활성 — title 은 prompt.preview 있을 때만(원본 promptTitle 조건부).
    const titleProps = turn.prompt?.preview ? { title: turn.prompt.preview } : {};
    return (
      <span className={cls} data-turn={turn.turn_id} role="tab" aria-selected={ariaSel} {...titleProps}>
        {marker}
      </span>
    );
  }

  // 활성 — 마커 + chip-flow(원본 turn-views.js:273-274). 활성 turn-line 에는 title 미부여(원본 동일).
  return (
    <span className={cls} data-turn={turn.turn_id} role="tab" aria-selected={ariaSel}>
      {marker}
      <span className="chip-flow">
        <ChipFlow turn={turn as Record<string, unknown>} />
      </span>
    </span>
  );
}

/**
 * 모든 턴을 turn-spine inline-flow 로 렌더. 원본 renderSpine(turn-views.js:292) 동치.
 *  - 정렬: turn_index 내림차순(최신 좌측).
 *  - TurnLine 사이에 SpineArrow(마지막 제외).
 *  - turns 없으면 null(원본 빈 문자열).
 */
export function TurnSpine({
  turns,
  activeTurnId,
}: {
  turns: TurnLike[] | null | undefined;
  activeTurnId: string | null;
}): ReactElement | null {
  if (!turns || turns.length === 0) return null;
  const sorted = turns.slice().sort((a, b) => b.turn_index - a.turn_index);
  return (
    <>
      {sorted.map((turn, i) => (
        <Fragment key={turn.turn_id}>
          <TurnLine turn={turn} isActive={turn.turn_id === activeTurnId} />
          {i < sorted.length - 1 ? <SpineArrow /> : null}
        </Fragment>
      ))}
    </>
  );
}
