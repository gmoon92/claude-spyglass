/**
 * `spyglass analyze` — 운영자 수동 트리거 백필 (anomaly-bloated-sys T-08).
 *
 * @description
 *   ADR-001/002 백필 정책:
 *   - 신규 자동 적용: hook 수집기(T-07) 픽스 + proxy 측 system_byte_size 정상 수집은
 *     이후 도착 데이터에 자동 적용된다.
 *   - 기존 데이터: 본 CLI 가 운영자 수동 트리거로만 동작 (자동 실행 금지).
 *
 *   대상 두 컬럼:
 *   1) proxy_requests.system_byte_size — payload(zstd)에서 body.system 정규화 후 byte_size 채움
 *      (`backfill-system-prompts.ts` 스크립트와 동일 로직 — 본 CLI 는 진단 + 단순 위임).
 *   2) requests.parent_tool_use_id — subagent transcript 재파싱하여 Skill/Task rolling parent 적용
 *      (T-07 로직 재사용 — extractSubagentToolCalls + persistSubagentChildren).
 *      ※ 본 라운드에서는 진단(누락 행 수 보고) + dry-run 까지만 제공.
 *        실제 행을 UPDATE 하는 backfill 은 transcript 파일 위치 매핑 + idempotent INSERT 정책이
 *        세션별로 달라 위험도가 높으므로, 운영자가 후속 패치에서 적용 (TODO 주석).
 *
 * 사용:
 *   bun run packages/server/src/cli.ts analyze --backfill 2026-05-01:2026-05-18
 *   bun run packages/server/src/cli.ts analyze --backfill 2026-05-01:2026-05-18 --dry-run
 *
 * 종료 코드: 0 = 정상, 1 = 인자/파일 오류.
 *
 * @see packages/server/scripts/backfill-system-prompts.ts (system_byte_size 실제 백필 로직)
 * @see packages/server/src/hook/handlers/post-tool-use.handler.ts (parent_tool_use_id 신규 수집 로직)
 * @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-001 / ADR-002
 */

import type { Database } from 'bun:sqlite';
import { getDatabase, upsertSystemPrompt } from '@spyglass/storage';
import { normalizeSystem } from '../proxy/system-hash';
import { invalidateAnomalyThresholdsCache } from '../anomaly-thresholds';
import { t } from '../i18n';

interface BackfillRange {
  fromMs: number;
  toMs: number;
}

interface AnalyzeArgs {
  range: BackfillRange | null;
  dryRun: boolean;
  showHelp: boolean;
}

/**
 * `YYYY-MM-DD:YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:MM:SSZ:YYYY-MM-DDTHH:MM:SSZ` 형식 파싱.
 *
 * 단순 ISO 8601 양쪽을 콜론으로 결합. 종료일은 23:59:59.999로 자동 연장.
 */
function parseRange(spec: string): BackfillRange | null {
  // 'YYYY-MM-DD:YYYY-MM-DD' 같은 short 포맷을 먼저 시도 (콜론이 2개).
  // ISO with time은 'T' 가 포함되므로 콜론 분리는 별도 처리 필요.
  const idx = spec.indexOf(':');
  if (idx < 0) return null;

  // 두 토큰을 정확히 1개의 콜론으로 분리 — short(YYYY-MM-DD) 두 개.
  if (/^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(spec)) {
    const [fromStr, toStr] = spec.split(':');
    const fromMs = Date.parse(`${fromStr}T00:00:00Z`);
    const toMs = Date.parse(`${toStr}T23:59:59.999Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
    return { fromMs, toMs };
  }

  return null;
}

function parseArgs(args: string[]): AnalyzeArgs {
  const showHelp = args.includes('--help') || args.includes('-h');
  const dryRun = args.includes('--dry-run');

  let range: BackfillRange | null = null;
  const backfillIdx = args.indexOf('--backfill');
  if (backfillIdx >= 0 && args[backfillIdx + 1]) {
    range = parseRange(args[backfillIdx + 1]);
  }

  return { range, dryRun, showHelp };
}

function printHelp(): void {
  // i18n-extract gate (브랜드 위험 회귀 방지): 사용자 노출 문자열은 모두 t() 키 경유.
  console.log(t('cli.analyze.help-header'));
  console.log('');
  console.log(t('cli.analyze.help-usage'));
  console.log('');
  console.log(t('cli.analyze.help-options-backfill'));
  console.log(t('cli.analyze.help-options-dry-run'));
  console.log(t('cli.analyze.help-options-help'));
  console.log('');
  console.log(t('cli.analyze.help-targets-header'));
  console.log(t('cli.analyze.help-targets-1'));
  console.log(t('cli.analyze.help-targets-2'));
}

interface SystemBackfillReport {
  eligible: number;
  processed: number;
  updated: number;
  decodeError: number;
  nullSystem: number;
}

interface ParentBackfillReport {
  /** parent_tool_use_id IS NULL AND source='subagent-transcript' 인 행 수 */
  candidate: number;
  /** transcript 재파싱이 적용된 행 수 (현재 라운드에서는 0 — TODO) */
  applied: number;
}

/**
 * proxy_requests.system_byte_size 백필 — payload 디코드 + system 정규화.
 *
 * `backfill-system-prompts.ts` 스크립트 로직과 동일하되 본 CLI 내부에서 범위 필터를 추가하고
 * 진행 로그만 자체 출력. 멱등 보장 (이미 채워진 행은 WHERE system_hash IS NULL 로 건너뜀).
 */
function backfillSystemByteSize(
  db: Database,
  range: BackfillRange,
  dryRun: boolean,
): SystemBackfillReport {
  const eligibleRow = db
    .query(
      `SELECT COUNT(*) AS cnt FROM proxy_requests
        WHERE system_hash IS NULL
          AND payload IS NOT NULL
          AND timestamp BETWEEN ? AND ?`,
    )
    .get(range.fromMs, range.toMs) as { cnt: number };
  const eligible = eligibleRow.cnt;

  console.log(t('cli.analyze.sys-eligible', { count: eligible }));
  if (eligible === 0) {
    return { eligible: 0, processed: 0, updated: 0, decodeError: 0, nullSystem: 0 };
  }

  const updateStmt = db.prepare(
    `UPDATE proxy_requests SET system_hash = ?, system_byte_size = ?
      WHERE id = ? AND system_hash IS NULL`,
  );

  let processed = 0;
  let updated = 0;
  let decodeError = 0;
  let nullSystem = 0;

  const BATCH = 100;
  let offset = 0;
  while (offset < eligible) {
    const rows = db
      .query<{ id: string; timestamp: number; payload: Uint8Array }, [number, number, number]>(
        `SELECT id, timestamp, payload FROM proxy_requests
          WHERE system_hash IS NULL
            AND payload IS NOT NULL
            AND timestamp BETWEEN ? AND ?
          ORDER BY timestamp ASC LIMIT ?`,
      )
      .all(range.fromMs, range.toMs, BATCH);

    if (rows.length === 0) break;

    const trx = db.transaction(() => {
      for (const row of rows) {
        processed++;
        let body: { system?: unknown };
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = (Bun as any).zstdDecompressSync(row.payload);
          const text = new TextDecoder().decode(raw);
          body = JSON.parse(text);
        } catch {
          decodeError++;
          continue;
        }
        const norm = normalizeSystem(body.system);
        if (!norm) {
          nullSystem++;
          continue;
        }
        if (!dryRun) {
          upsertSystemPrompt(db, {
            hash: norm.hash,
            content: norm.normalized,
            byteSize: norm.byteSize,
            segmentCount: norm.segmentCount,
            nowMs: row.timestamp,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = (updateStmt as any).run(norm.hash, norm.byteSize, row.id);
          if (result.changes > 0) updated++;
        } else {
          updated++;
        }
      }
    });
    trx();

    offset += rows.length;
    if (offset % 1000 === 0 || offset >= eligible) {
      console.log(t('cli.analyze.sys-progress', { done: offset, total: eligible }));
    }
  }

  return { eligible, processed, updated, decodeError, nullSystem };
}

/**
 * requests.parent_tool_use_id 누락 행 진단 (T-08 라운드).
 *
 * 진짜 backfill(transcript 재파싱 + UPDATE)은 transcript 파일 위치를 세션별로 다시 매핑해야 하고,
 * 신규 hook 픽스(T-07)가 적용된 이후 데이터는 자동 정상화되므로, 본 라운드에서는 누락 행 수만 보고.
 *
 * 운영자 가이드:
 *   - 누락 행이 0이면 신규 hook 픽스가 정상 동작 중.
 *   - 누락 행이 다수면 hook 수집기 픽스 이전 데이터 — agent-spike 검출에서 깊이 2 자식이 누락될 수 있음.
 *     후속 패치에서 transcript 디스크 재파싱을 추가하거나, doctor --fix 로 매크로 제공 예정 (TODO).
 */
function diagnoseParentToolUseId(db: Database, range: BackfillRange): ParentBackfillReport {
  const row = db
    .query(
      `SELECT COUNT(*) AS cnt FROM requests
        WHERE source = 'subagent-transcript'
          AND parent_tool_use_id IS NULL
          AND timestamp BETWEEN ? AND ?`,
    )
    .get(range.fromMs, range.toMs) as { cnt: number };

  return { candidate: row.cnt, applied: 0 };
}

/**
 * `spyglass analyze` 메인 진입점 — packages/server/src/cli.ts 에서 호출.
 */
export async function analyze(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.showHelp || !parsed.range) {
    printHelp();
    if (!parsed.range && !parsed.showHelp) {
      console.error('\n' + t('cli.error-prefix') + ' ' + t('cli.analyze.error-range-required'));
      process.exit(1);
    }
    return;
  }

  const dryRunLabel = parsed.dryRun ? ' [DRY-RUN]' : '';
  console.log(t('cli.analyze.header', { dryRun: dryRunLabel }));
  console.log(t('cli.analyze.range-label', {
    from: new Date(parsed.range.fromMs).toISOString(),
    to: new Date(parsed.range.toMs).toISOString(),
  }));
  console.log('');

  const wrapper = getDatabase();
  const db = wrapper.instance;

  // ── 1) proxy_requests.system_byte_size 백필 ──
  const sys = backfillSystemByteSize(db, parsed.range, parsed.dryRun);

  // ── 2) requests.parent_tool_use_id 진단 ──
  const parent = diagnoseParentToolUseId(db, parsed.range);

  // 캐시 무효화 — 임계는 안 바뀌지만 새 데이터로 다음 anomaly 판정이 즉시 반영되도록 일관성 차원.
  if (!parsed.dryRun) {
    invalidateAnomalyThresholdsCache();
  }

  // ── 요약 ──
  console.log('');
  console.log(t('cli.analyze.summary-header', { dryRun: dryRunLabel }));
  console.log(t('cli.analyze.summary-sys-title'));
  console.log(t('cli.analyze.summary-sys-eligible', { n: sys.eligible }));
  console.log(t('cli.analyze.summary-sys-processed', { n: sys.processed }));
  console.log(t('cli.analyze.summary-sys-updated', { n: sys.updated }));
  console.log(t('cli.analyze.summary-sys-decode-err', { n: sys.decodeError }));
  console.log(t('cli.analyze.summary-sys-null-system', { n: sys.nullSystem }));
  console.log(t('cli.analyze.summary-parent-title'));
  console.log(t('cli.analyze.summary-parent-candidate', { n: parent.candidate }));
  console.log(t('cli.analyze.summary-parent-applied', { n: parent.applied }));
  if (parsed.dryRun) {
    console.log('\n' + t('cli.analyze.summary-dry-run-tail'));
  }
}
