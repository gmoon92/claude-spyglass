/**
 * hook 모듈 — Strategy Pattern 인터페이스 정의
 *
 * 책임:
 *  - hook_event_name별로 다른 정제 로직을 다형적으로 처리하기 위한 추상화.
 *  - 자바의 `interface HookEventHandler { handle(payload, ctx); }` 구조와 동일.
 *
 * 디자인 결정:
 *  - 각 핸들러는 raw ClaudeHookPayload를 받아 NormalizedHookPayload로 정제하는 책임만 가짐.
 *  - DB 저장은 processor.ts(processHookEvent)가 단일 진입점으로 담당 → 핸들러는 정제 only.
 *  - 새 hook event(예: SubagentStop)가 추가되면 핸들러 클래스 1개 추가 + dispatcher 등록 1줄.
 *    기존 코드 수정 없음 (OCP 준수).
 *
 * 자바 비유:
 *   public interface HookEventHandler {
 *     String getEventType();
 *     HookProcessResult handle(ClaudeHookPayload raw, HookContext ctx);
 *   }
 *
 * 외부 노출:
 *  - HookEventHandler  : 인터페이스
 *  - HookContext       : 핸들러가 필요로 하는 외부 의존성(DB, 시각, project_name 등) 묶음
 *
 * 호출자: dispatcher.ts (등록·라우팅)
 * 의존성: bun:sqlite, types
 */

import type { Database } from 'bun:sqlite';
import type { ClaudeHookPayload, HookProcessResult } from './types';

/**
 * 핸들러 실행 시 필요한 컨텍스트.
 *
 * - db          : SQLite Database 핸들 (정제 후 processHookEvent로 전달)
 * - now         : 핸들러 진입 시각 — Date.now() 캐시 (한 요청 내 일관성)
 * - projectName : cwd에서 추출한 프로젝트 이름 (기본 'unknown')
 *
 * 핸들러는 이 외 외부 상태 없이 raw + ctx만으로 동작 → 테스트 용이.
 */
export interface HookContext {
  db: Database;
  now: number;
  projectName: string;
}

/**
 * hook event 정제기 인터페이스 (Strategy Pattern).
 *
 * 구현체:
 *  - PreToolUseHandler
 *  - PostToolUseHandler
 *  - UserPromptSubmitHandler
 *  - SystemEventHandler (fallback — 그 외 이벤트)
 *
 * @method eventType  : 이 핸들러가 처리하는 hook_event_name (registry 키)
 * @method handle     : raw 페이로드를 정제 → DB 저장 → 결과 반환
 */
export interface HookEventHandler {
  /** 이 핸들러가 담당하는 hook_event_name (예: 'PreToolUse') */
  readonly eventType: string;

  /**
   * raw 페이로드를 정제하고 DB에 저장한 뒤 결과를 반환.
   *
   * 구현 책임:
   *  1. raw → NormalizedHookPayload 정제 (transcript 파싱·도구 detail·감사 메타 등)
   *  2. processHookEvent(ctx.db, payload) 호출 → DB 저장 + SSE 브로드캐스트
   *  3. (필요 시) 후속 작업 (예: PostToolUseHandler의 서브에이전트 자식 INSERT)
   */
  handle(raw: ClaudeHookPayload, ctx: HookContext): HookProcessResult;
}
