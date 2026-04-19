// 이상 감지 — 순수 함수, 추가 API 없이 프론트엔드 계산

/**
 * requests 배열을 분석하여 각 요청 ID에 대한 anomaly 플래그 Set 반환
 * @param {Array} requests
 * @param {number|null} p95DurationMs — /api/requests meta.p95DurationMs 값
 * @returns {Map<string, Set<'spike'|'loop'|'slow'>>}
 */
export function detectAnomalies(requests, p95DurationMs = null) {
  const anomalyMap = new Map();

  // 1. Token Spike: 세션별 prompt tokens_input 평균의 200% 초과
  const sessionTokens = new Map(); // session_id → tokens_input[]
  for (const r of requests) {
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const arr = sessionTokens.get(r.session_id) || [];
      arr.push(r.tokens_input);
      sessionTokens.set(r.session_id, arr);
    }
  }
  for (const r of requests) {
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const arr = sessionTokens.get(r.session_id) || [];
      if (arr.length < 2) continue; // 비교 기준 없으면 skip
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (r.tokens_input > avg * 2) {
        const flags = anomalyMap.get(r.id) || new Set();
        flags.add('spike');
        anomalyMap.set(r.id, flags);
      }
    }
  }

  // 2. Loop: turn_id 내 동일 tool_name 연속 3회 이상
  const turnGroups = new Map(); // turn_id → [{id, tool_name}]
  for (const r of requests) {
    if (r.type === 'tool_call' && r.turn_id && r.tool_name) {
      const arr = turnGroups.get(r.turn_id) || [];
      arr.push({ id: r.id, tool_name: r.tool_name });
      turnGroups.set(r.turn_id, arr);
    }
  }
  for (const [, calls] of turnGroups) {
    let streak = 1;
    for (let i = 1; i < calls.length; i++) {
      if (calls[i].tool_name === calls[i - 1].tool_name) {
        streak++;
        if (streak >= 3) {
          for (let j = i - streak + 1; j <= i; j++) {
            const flags = anomalyMap.get(calls[j].id) || new Set();
            flags.add('loop');
            anomalyMap.set(calls[j].id, flags);
          }
        }
      } else {
        streak = 1;
      }
    }
  }

  // 3. Slow: tool_call duration_ms가 P95 초과
  if (p95DurationMs != null && p95DurationMs > 0) {
    for (const r of requests) {
      if (r.type === 'tool_call' && r.duration_ms > p95DurationMs) {
        const flags = anomalyMap.get(r.id) || new Set();
        flags.add('slow');
        anomalyMap.set(r.id, flags);
      }
    }
  }

  return anomalyMap;
}
