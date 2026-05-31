// errors.ts — catch 절 unknown 좁히기 헬퍼 SSoT (P5-03).
//
// strict:true 에서 catch 변수는 unknown 이 권장된다(`any` 금지). 8개 catch 절이
// 공통으로 쓰던 `String(err?.message ?? err)` / `e?.name === 'AbortError'` 패턴을
// 타입 안전 헬퍼로 추출한다(2곳 이상 재사용 — 공용 util 기준 충족).
//
// 런타임 동작: 기존 인라인 표현식과 1:1 동치 — 회귀 0.
//   - errMessage(err): err 가 Error 면 message, 아니면 String(err). 기존 `String(err?.message ?? err)`
//     와 동일 결과(Error 객체는 message, 원시값/null 은 String 변환).
//   - isAbortError(err): err.name === 'AbortError' 여부. 기존 `e?.name === 'AbortError'` 와 동일.

/**
 * catch 로 잡은 unknown 에러에서 표시용 메시지 문자열을 안전 추출한다.
 * Error 인스턴스면 .message, 그 외(원시값/null/객체)는 String() 변환.
 */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

/** fetch abort(AbortSignal.timeout/abort) 로 인한 DOMException 인지 판별. */
export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'name' in err &&
    (err as { name?: unknown }).name === 'AbortError';
}
