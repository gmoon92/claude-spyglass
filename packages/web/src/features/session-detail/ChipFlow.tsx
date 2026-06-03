/**
 * features/session-detail/ChipFlow.tsx — 활성 턴 chip-flow 시퀀스 (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js#chipFlowHtml (turn-views.js:224).
 *  - compressFlowWithResponses(turn) → 흐름 항목 → Chip + 칩 사이 ChipArrow.
 *  - 첫 칩 앞에는 화살표 생략(원본 `if (i > 0)`).
 *  - response 항목마다 respSeq 1-based 누적 → chip-key.
 *
 * SSoT 재사용(재구현 금지): compressFlowWithResponses → turn-rows.js (P3-05 lib 계약, §2.1).
 *
 * @module features/session-detail/ChipFlow
 */
import { Fragment, type ReactElement } from 'react';
import { Chip, ChipArrow, type FlowItem } from './Chip';
import { compressFlowWithResponses } from './turn-rows';

/**
 * 활성 턴의 도구·응답 흐름을 inline chip 시퀀스로 직렬화한다.
 * 감싸는 wrapper 없이 자식들만 반환(원본 chipFlowHtml 와 동일 — 호출부가 .chip-flow 래퍼 부여).
 */
export function ChipFlow({ turn }: { turn: Record<string, unknown> }): ReactElement {
  const flow = compressFlowWithResponses(turn) as FlowItem[];
  let respSeq = 0;
  return (
    <>
      {flow.map((item, i) => {
        if (item.kind === 'response') respSeq += 1;
        return (
          <Fragment key={i}>
            {i > 0 ? <ChipArrow /> : null}
            <Chip item={item} respSeq={respSeq} />
          </Fragment>
        );
      })}
    </>
  );
}
