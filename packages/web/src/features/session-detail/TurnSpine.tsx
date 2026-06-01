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
 *
 * 마커 클릭(원본 main.js:803-804 `.turn-line[data-turn]` 위임 → toggleTurn):
 *  - 비활성 마커 클릭 시 onMarkerClick(turn_id) 으로 활성 턴 전환을 위임한다.
 *  - 칩(.chip-flow 안 [data-chip-key]) 클릭은 마커 핸들러가 아닌 FlowPane 의 칩 위임이 처리하므로,
 *    여기서는 마커 자체(.ds-turn-marker) 클릭만 onMarkerClick 으로 흘려보낸다(원본 분리 동선 보존).
 */
export function TurnLine({
  turn,
  isActive,
  onMarkerClick,
}: {
  turn: TurnLike;
  isActive: boolean;
  onMarkerClick?: (turnId: string) => void;
}): ReactElement {
  const indexLabel = `T${turn.turn_index}`;
  const cls = `turn-line${isActive ? ' is-active' : ''}`;
  const ariaSel = isActive ? 'true' : 'false';

  const onMarker = onMarkerClick ? () => onMarkerClick(turn.turn_id) : undefined;

  // 마커 — 원본 turn-views.js:262-265. 활성일 때만 data-state="active".
  const marker = (
    <span className="ds-turn-marker" {...(isActive ? { 'data-state': 'active' } : {})} onClick={onMarker}>
      <span className="marker-dot" />
      <span className="marker-index">{indexLabel}</span>
    </span>
  );

  if (!isActive) {
    // 비활성 — title 은 prompt.preview 있을 때만(원본 promptTitle 조건부).
    const titleProps = turn.prompt?.preview ? { title: turn.prompt.preview } : {};
    return (
      <span
        className={cls}
        data-turn={turn.turn_id}
        role="tab"
        aria-selected={ariaSel}
        onClick={onMarker}
        {...titleProps}
      >
        {marker}
      </span>
    );
  }

  // 활성 — 마커 + chip-flow(원본 turn-views.js:273-274). 활성 turn-line 에는 title 미부여(원본 동일).
  //   활성 turn-line 자체에는 onClick 미부여 — 활성 턴 재선택은 무동작(원본 toggleTurn 가드 동치),
  //   칩 클릭은 FlowPane 칩 위임이 따로 처리한다.
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
  onMarkerClick,
}: {
  turns: TurnLike[] | null | undefined;
  activeTurnId: string | null;
  /** 비활성 마커 클릭 → 활성 턴 전환 위임(원본 main.js:803-804 toggleTurn). */
  onMarkerClick?: (turnId: string) => void;
}): ReactElement | null {
  if (!turns || turns.length === 0) return null;
  const sorted = turns.slice().sort((a, b) => b.turn_index - a.turn_index);
  return (
    <>
      {sorted.map((turn, i) => (
        <Fragment key={turn.turn_id}>
          <TurnLine
            turn={turn}
            isActive={turn.turn_id === activeTurnId}
            onMarkerClick={onMarkerClick}
          />
          {i < sorted.length - 1 ? <SpineArrow /> : null}
        </Fragment>
      ))}
    </>
  );
}
