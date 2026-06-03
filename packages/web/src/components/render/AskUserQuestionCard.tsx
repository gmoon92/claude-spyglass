/**
 * render/AskUserQuestionCard.tsx — AskUserQuestion 펼침 카드 React 컴포넌트 (B-2)
 *
 * 원본: assets/js/render/extract(buildAskUserQuestionHtml HTML-string producer).
 *   `<div class="askq-block"><div class="askq-q">…<ul class="askq-options"><li class="askq-option …">…`.
 *
 * 정공법(SSoT 이중화 금지):
 *  - 파싱(question/option/selected/multi 판정)은 extract.ts#parseAskUserQuestion(순수 SSoT) 단독.
 *  - 마커 SVG 는 동치 검증된 TSX Radio/Check 재사용(원본 svgRadio/svgCheck 와 동일 마크업).
 *  - 마크업(div/ul/li class·data-tone·title) 1:1 재현.
 *
 * @module render/AskUserQuestionCard
 */
import type { ReactElement } from 'react';
import type { AskQuestion } from './extract';
import { Radio, Check } from '../design-system/icons';

/** 옵션 li — 원본 buildAskUserQuestionHtml 의 li 마크업 1:1. */
function AskOptionLi({
  label,
  desc,
  selected,
  multi,
}: {
  label: string;
  desc: string;
  selected: boolean;
  multi: boolean;
}): ReactElement {
  const cls = ['askq-option'];
  if (selected) cls.push('askq-option-selected');
  if (multi) cls.push('askq-option-multi');
  return (
    <li className={cls.join(' ')} title={desc || undefined}>
      <span className="askq-option-marker">
        {multi ? <Check selected={selected} size={12} /> : <Radio selected={selected} size={12} />}
      </span>
      <span className="askq-option-label">{label}</span>
      {desc ? <span className="askq-option-desc">{desc}</span> : null}
    </li>
  );
}

/** AskUserQuestion 펼침 카드. parseAskUserQuestion 모델을 받아 askq-block 을 렌더. */
export function AskUserQuestionCard({ questions }: { questions: AskQuestion[] }): ReactElement {
  return (
    <div className="askq-block">
      {questions.map((q, i) => (
        <div className="askq-q" key={i}>
          <div className="askq-q-head">
            {q.header ? (
              <span className="askq-header ds-badge" data-tone="brand">
                {q.header}
              </span>
            ) : null}
            <span className="askq-question">{q.question}</span>
            {q.multi ? (
              <>
                {' '}
                <span className="askq-multi-hint">(multi-select)</span>
              </>
            ) : null}
          </div>
          {q.options.length > 0 ? (
            <ul className="askq-options">
              {q.options.map((o, j) => (
                <AskOptionLi key={j} label={o.label} desc={o.desc} selected={o.selected} multi={o.multi} />
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
