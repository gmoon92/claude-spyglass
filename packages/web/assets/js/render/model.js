// 모델 분류·칩 렌더링 — ADR-data-trust-visual-001 / ADR-token-trust-cleanup-001.
//
// 변경 이유: 모델 family/버전 매핑 정책, trust 시각 표지 정책 변경 시 묶여서 손이 가는 묶음.

import { escHtml } from '../formatters.js';

/**
 * 모델 분류 — ADR-data-trust-visual-001
 * @param {string|null} model
 * @returns {'haiku'|'sonnet'|'opus'|'external'|'synthetic'|'unknown'}
 */
export function modelClassOf(model) {
  if (!model) return 'unknown';
  const m = String(model).toLowerCase();
  if (m === 'synthetic' || m === '<synthetic>') return 'synthetic';
  // claude-haiku-..., claude-3-5-haiku, claude-3.5-haiku-... 모두 매칭
  if (m.includes('haiku'))  return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus'))   return 'opus';
  if (m.startsWith('kimi-') || m.startsWith('kimi'))           return 'external';
  return 'unknown';
}

/**
 * 신뢰도 분류 — ADR-data-trust-visual-001 / ADR-token-trust-cleanup-001
 *
 * 책임:
 *   행(prompt/response) 렌더링 시 model/토큰 신뢰도를 단일 키워드로 분류한다.
 *
 * 호출자:
 *   - makeRequestRow → rowTrustClass / data-trust 속성
 *   - session-detail.buildTurnDetailRows → turn-row data-trust 속성
 *   - modelChipHtml 내부 (보조 라벨 결정용 — 현재는 라벨 없음)
 *
 * 우선순위:
 *   synthetic > unknown > trusted (external은 trusted로 처리)
 *
 * 'estimated' 제거 사유 (ADR-token-trust-cleanup-001):
 *   - 'estimated'는 토큰 출처 추정이지 model 추정이 아닌데,
 *     UI에서는 model 칩 옆에 라벨링되어 명칭 오용 발생.
 *   - server proxy backfill 확장으로 hook 행의 tokens_source가
 *     proxy 응답 시점에 'proxy'/'high'로 승격되므로 'unavailable'은
 *     1~2초 transient 상태로만 존재 → 시각 표지 가치 소멸.
 *   - synthetic/unknown은 운영자가 알아야 하는 비정상 상태이므로 유지.
 *
 * @param {{model?: string|null, tokens_source?: string|null}} r
 * @returns {'trusted'|'synthetic'|'unknown'}
 */
export function trustOf(r) {
  const cls = modelClassOf(r?.model);
  if (cls === 'synthetic') return 'synthetic';
  if (cls === 'unknown')   return 'unknown';
  return 'trusted';
}

/**
 * 모델 칩의 짧은 라벨 — ADR-data-trust-visual-001
 * 예: "claude-sonnet-4-5-20250929" → "Sonnet 4.5"
 *     "claude-opus-4-7-20260101"   → "Opus 4.7"
 *     "kimi-k2-0905-preview"        → "Kimi k2"
 *     null                          → "모델불명"
 *     "<synthetic>" / "synthetic"   → "SDK 합성"
 */
export function modelChipLabel(model, cls) {
  if (cls === 'unknown')   return '모델불명';
  if (cls === 'synthetic') return 'SDK 합성';
  if (cls === 'external') {
    const m = String(model);
    const head = m.split('-').slice(0, 2).join(' ');
    return head.charAt(0).toUpperCase() + head.slice(1);
  }
  // claude-{family}-{major}-{minor}-{date} 또는 claude-{major}-{minor}-{family}-{date}
  const m = String(model);
  // 신형: claude-(haiku|sonnet|opus)-{major}-{minor}
  let match = m.match(/claude-(haiku|sonnet|opus)-(\d+)(?:[-.](\d+))?/i);
  if (match) {
    const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    const ver = match[3] ? `${match[2]}.${match[3]}` : match[2];
    return `${family} ${ver}`;
  }
  // 구형: claude-{major}-{minor}-(haiku|sonnet|opus)
  match = m.match(/claude-(\d+)(?:[-.](\d+))?-(haiku|sonnet|opus)/i);
  if (match) {
    const family = match[3].charAt(0).toUpperCase() + match[3].slice(1);
    const ver = match[2] ? `${match[1]}.${match[2]}` : match[1];
    return `${family} ${ver}`;
  }
  // 기타 — family 단어만 추출
  const fm = m.match(/(haiku|sonnet|opus)/i);
  if (fm) return fm[1].charAt(0).toUpperCase() + fm[1].slice(1);
  return model;
}

/**
 * 모델 칩 HTML — title 속성에 풀네임 보관
 *
 * 책임:
 *   model 식별 칩(둥근 dot + family-version 라벨)을 단일 HTML 토큰으로 반환.
 *   호출자는 prompt/response/tool_call 행 어디에서나 동일 칩을 재사용한다.
 *
 * 호출자:
 *   - makeModelCell (테이블 셀)
 *   - session-detail.buildTurnDetailRows (turn-row main span, mini variant)
 *   - targetInnerHtml (Skill/Agent target에서 model 보조 표시)
 *
 * 의존성:
 *   - modelClassOf, modelChipLabel — 칩 클래스/라벨 결정
 *   - escHtml — XSS 방어
 *
 * @param {object} r 행 raw 데이터 (model, tokens_source 필드 사용)
 * @param {object} [opts]
 * @param {boolean} [opts.mini] turn view용 mini variant 적용
 *
 * 'trust-label' 제거 (ADR-token-trust-cleanup-001):
 *   기존에는 tokens_source==='unavailable' 시 칩 옆 dashed "추정" 라벨을 부착했으나,
 *   명칭 오용 + transient 상태라 제거. trustOf 분기에서도 'estimated'가 사라졌다.
 */
export function modelChipHtml(r, opts = {}) {
  const cls     = modelClassOf(r?.model);
  const label   = modelChipLabel(r?.model, cls);
  const title   = r?.model || '모델 정보 없음';
  const sizeCls = opts.mini ? ' model-chip-mini' : '';
  return `<span class="model-chip model-chip-${cls}${sizeCls}" title="${escHtml(title)}">${escHtml(label)}</span>`;
}

export function makeModelCell(r) {
  // 모든 타입에서 model을 표시. model이 없으면 "—".
  // (이전: tool_call/system은 무조건 "—" 처리 → 사용자가 LLM 모델을 알 수 없음)
  // ADR-001: 서버 정규화로 raw model이 NULL이어도 turn 폴백된 model이 들어와 있다.
  if (!r?.model) {
    return `<td class="cell-model cell-empty" data-cell="model">—</td>`;
  }
  return `<td class="cell-model" data-cell="model">${modelChipHtml(r)}</td>`;
}

/**
 * row trust 클래스 — synthetic / unknown 행에만 ' row-trust-{name}' 클래스 부여.
 *
 * 책임:
 *   makeRequestRow의 <tr> 클래스 결정. 비정상 신뢰도 행만 시각 dim 처리.
 *
 * 호출자:
 *   - makeRequestRow (단일 호출 지점)
 *
 * 의존성:
 *   - trustOf — 신뢰도 분류
 *
 * 분기:
 *   - tool_call / system: model 무의미 → dim 적용 안 함
 *   - trusted / external: 정상 → dim 적용 안 함
 *   - synthetic / unknown: ' row-trust-{name}' 클래스 부여
 *
 * 'estimated' 분기는 ADR-token-trust-cleanup-001로 제거됨.
 */
export function rowTrustClass(r) {
  if (r.type === 'tool_call' || r.type === 'system') return '';
  const t = trustOf(r);
  if (t === 'trusted' || t === 'external') return '';
  return ` row-trust-${t}`;
}
