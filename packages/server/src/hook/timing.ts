/**
 * hook 모듈 — Pre/Post Tool 타이밍 인메모리 맵
 *
 * 책임:
 *  - PreToolUse 시각을 메모리에 저장하고, PostToolUse에서 빼서 duration_ms 계산.
 *
 * 키: tool_use_id (Claude Code가 Pre/Post 쌍에 동일 id 부여 — 병렬 도구 실행 안전)
 * 값: PreToolUse 수신 timestamp (ms)
 *
 * ADR-002: 파일 기반(~/.spyglass/timing/{session_id}) → 인메모리 Map 교체
 *  - 단일 프로세스 가정: 서버 재시작 시 진행 중이던 Pre/Post 쌍은 유실됨 (드물고 영향 미미)
 *
 * 폴백: PostToolUse hook payload에 duration_ms가 직접 들어오는 경우(Claude Code 신버전)도 있어
 *       raw-handler.ts는 payload 우선, timing map은 보조로 사용.
 *
 * 외부 노출: toolTimingMap (mutable Map — 호출자가 set/get/delete)
 * 호출자: raw-handler.ts (PreToolUse: set / PostToolUse: get + delete)
 * 의존성: 없음
 */

/**
 * Pre/Post Tool 타이밍 맵.
 * - PreToolUse: toolTimingMap.set(tool_use_id, Date.now())
 * - PostToolUse: const start = toolTimingMap.get(tool_use_id); toolTimingMap.delete(tool_use_id);
 */
export const toolTimingMap = new Map<string, number>();
