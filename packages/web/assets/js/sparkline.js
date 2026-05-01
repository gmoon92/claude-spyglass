/**
 * Sparkline (inline SVG) 헬퍼 모듈
 *
 * left-panel-observability-revamp ADR-002:
 *   외부 차트 라이브러리 의존성 없이 200B 미만 SVG 문자열을 생성한다.
 *   호출 측은 raw values 배열만 전달하고 빈/정상 분기는 함수 내부에서 처리한다.
 *
 * @example
 *   document.getElementById('spark').innerHTML =
 *     sparklineBars([1, 4, 2, 8, 5], { width: 96, height: 22, color: 'currentColor' });
 */

/** 빈/잘못된 입력 → 가운데 가는 baseline만 그려진 placeholder SVG */
function emptySvg(width, height, color) {
  const cy = height - 1;
  return (
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">` +
    `<line x1="0" y1="${cy}" x2="${width}" y2="${cy}" stroke="${color}" stroke-opacity="0.18" stroke-width="1"/>` +
    `</svg>`
  );
}

/**
 * 막대 sparkline (24h 1h 버킷 등 이산 데이터에 적합)
 *
 * @param {Array<number|null>} values  음수/null/NaN은 0으로 처리
 * @param {Object} [opts]
 * @param {number} [opts.width=96]
 * @param {number} [opts.height=22]
 * @param {string} [opts.color='currentColor']  CSS 변수 통과 가능
 * @param {number} [opts.gap=1]                  bar 사이 픽셀 간격
 * @returns {string} SVG 문자열
 */
export function sparklineBars(values, opts = {}) {
  const width = opts.width ?? 96;
  const height = opts.height ?? 22;
  const color = opts.color ?? 'currentColor';
  const gap = opts.gap ?? 1;

  if (!Array.isArray(values) || values.length === 0) {
    return emptySvg(width, height, color);
  }
  const safe = values.map(v =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
  );
  const max = Math.max(...safe, 1);
  if (max === 0) return emptySvg(width, height, color);

  const n = safe.length;
  const barW = Math.max(1, (width - gap * (n - 1)) / n);
  const bars = safe
    .map((v, i) => {
      const h = Math.max(1, (v / max) * (height - 1));
      const x = i * (barW + gap);
      const y = height - h;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="${color}" rx="0.5"/>`;
    })
    .join('');
  return (
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`
  );
}

/**
 * 선 sparkline (연속 추세에 적합 — hit rate, latency 등)
 *
 * @param {Array<number|null>} values  null/NaN은 직선으로 보간
 * @param {Object} [opts]
 * @param {number} [opts.width=96]
 * @param {number} [opts.height=22]
 * @param {string} [opts.color='currentColor']
 * @param {boolean}[opts.fill=true]  영역 fill 여부 (15% alpha)
 * @returns {string} SVG 문자열
 */
export function sparklineLine(values, opts = {}) {
  const width = opts.width ?? 96;
  const height = opts.height ?? 22;
  const color = opts.color ?? 'currentColor';
  const fill = opts.fill ?? true;

  if (!Array.isArray(values) || values.length === 0) {
    return emptySvg(width, height, color);
  }
  const safe = values.map(v =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  );
  const valid = safe.filter(v => v !== null);
  if (valid.length === 0) return emptySvg(width, height, color);

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = max - min || 1;
  const n = safe.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const padY = 1;
  const innerH = height - padY * 2;

  // null 값은 직전 valid 값으로 채워서 직선화
  let lastValid = valid[0];
  const points = safe.map((v, i) => {
    if (v === null) v = lastValid;
    else lastValid = v;
    const x = i * stepX;
    const y = padY + innerH - ((v - min) / span) * innerH;
    return [x, y];
  });

  const linePath =
    'M ' +
    points
      .map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' L ');

  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">`;
  if (fill) {
    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
    svg += `<path d="${areaPath}" fill="${color}" fill-opacity="0.15"/>`;
  }
  svg += `<path d="${linePath}" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `</svg>`;
  return svg;
}
