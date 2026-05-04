/**
 * --fix 자동 수정 — chmod 등 권한 + ADR-001 P1 데이터 정합성 보정.
 *
 * 변경 이유: 자동 수정 가능한 항목 추가/제거 시.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { getDatabase, getDefaultDbPath, closeDatabase } from '@spyglass/storage';
import { log } from './output';

/**
 * --fix 플래그로 chmod 등 자동 수정
 */
export function applyFixes(): boolean {
  let fixed = false;

  // 1. DB 파일 권한 수정
  const dbPath = getDefaultDbPath();
  if (existsSync(dbPath)) {
    try {
      const stat = statSync(dbPath);
      if (stat.mode & 0o077) {
        execSync(`chmod 600 ${dbPath}`);
        log('ok', `DB 권한 수정: chmod 600 ${dbPath}`);
        fixed = true;
      }
    } catch {
      log('fail', `DB 권한 수정 실패: ${dbPath}`);
    }
  }

  // 2. 훅 스크립트 권한 수정
  const settingsPath = `${process.env.HOME}/.claude/settings.json`;
  if (existsSync(settingsPath)) {
    try {
      const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const spyglassDir = content.env?.SPYGLASS_DIR;

      if (spyglassDir) {
        const hookScript = `${spyglassDir}/hooks/spyglass-collect.sh`;
        if (existsSync(hookScript)) {
          const stat = statSync(hookScript);
          if ((stat.mode & parseInt('0111', 8)) === 0) {
            execSync(`chmod +x ${hookScript}`);
            log('ok', `훅 스크립트 권한 수정: chmod +x ${hookScript}`);
            fixed = true;
          }
        }
      }
    } catch {
      log('fail', '훅 스크립트 권한 수정 실패');
    }
  }

  // 3. ADR-001 P1 — 데이터 정합성 보정 (한 번에 처리)
  if (existsSync(getDefaultDbPath())) {
    try {
      const db = getDatabase().instance;

      // 3-1. 중복 response 제거: 같은 session, preview 동일, 1초 이내 차이의 두 행 중
      //      claude-code-hook(`resp-${ts}-${uuid}`)을 제거하고 transcript-assistant-text
      //      (`resp-msg-${msgid}`)를 보존. 후자가 토큰·모델 메타를 더 정확히 보유.
      const dupResult = db.prepare(`
        DELETE FROM requests
        WHERE id IN (
          SELECT a.id FROM requests a
          JOIN requests b
            ON a.session_id = b.session_id
           AND a.type = 'response' AND b.type = 'response'
           AND a.id != b.id
           AND a.preview = b.preview AND a.preview IS NOT NULL
           AND ABS(a.timestamp - b.timestamp) <= 1000
          WHERE a.source = 'claude-code-hook'
            AND b.source = 'transcript-assistant-text'
        )
      `).run();
      if (dupResult.changes > 0) {
        log('ok', `중복 response ${dupResult.changes}건 제거 (ADR-001 P1-A)`);
        fixed = true;
      }

      // 3-2. mismatched turn_id 교정: tool_call/response의 turn_id를 자기 timestamp 이전의
      //      가장 최근 prompt turn_id로 갱신. 잘못 태깅된 행만 영향.
      const mismatchResult = db.prepare(`
        UPDATE requests
        SET turn_id = (
          SELECT p.turn_id FROM requests p
          WHERE p.session_id = requests.session_id
            AND p.type = 'prompt'
            AND p.turn_id IS NOT NULL
            AND p.timestamp <= requests.timestamp
          ORDER BY p.timestamp DESC LIMIT 1
        )
        WHERE type IN ('tool_call', 'response')
          AND turn_id IS NOT NULL
          AND turn_id != COALESCE((
            SELECT p.turn_id FROM requests p
            WHERE p.session_id = requests.session_id
              AND p.type = 'prompt'
              AND p.turn_id IS NOT NULL
              AND p.timestamp <= requests.timestamp
            ORDER BY p.timestamp DESC LIMIT 1
          ), turn_id)
      `).run();
      if (mismatchResult.changes > 0) {
        log('ok', `mismatched turn_id ${mismatchResult.changes}건 교정 (ADR-001 P1-A)`);
        fixed = true;
      }

      closeDatabase();
    } catch (e) {
      try { closeDatabase(); } catch { /* ignore */ }
      log('fail', `데이터 정합성 보정 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return fixed;
}
