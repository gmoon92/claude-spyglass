/**
 * Storage Profiler — 오케스트레이션 (read-only)
 *
 * @description
 *   read-only로 연 DB에 대해 수집기들을 순차 실행하고 ProfileResult를 만든다.
 *   DB를 절대 수정하지 않는다(연결은 readonly + query_only). 리포트 렌더링은 호출자(CLI) 책임.
 *
 * @dependencies ./readonly-connection, ./collectors/*, ./types
 * @flow scripts/profile-storage.ts → profileStorage(opts) → renderReports()
 */

import { openReadOnly, defaultDbPath } from './readonly-connection';
import { collectPhysical } from './collectors/physical-size';
import { collectLogical } from './collectors/logical-size';
import { collectDedup, collectRealizedDedup } from './collectors/dedup';
import { collectChunkDedup } from './collectors/chunk-dedup';
import { collectLargest } from './collectors/largest-records';
import { getActiveKey } from '../runtime/encryption';
import type { ProfileResult } from './types';

export interface ProfileOptions {
  dbPath?: string;
  /** 컬럼당 dedup 측정 최대 행수. null이면 전수. */
  sampleLimit?: number | null;
  /** 측정 시각(ms). 결정성을 위해 호출자가 주입. */
  nowMs: number;
  /** Top-N 대형 레코드. */
  topN?: number;
}

export function profileStorage(opts: ProfileOptions): ProfileResult {
  const dbPath = opts.dbPath ?? defaultDbPath();
  const sampleLimit = opts.sampleLimit ?? null;
  const db = openReadOnly(dbPath);
  try {
    const key = getActiveKey();
    return {
      meta: {
        dbPath,
        generatedAtMs: opts.nowMs,
        sampleLimit,
        hasEncryptionKey: key != null,
      },
      physical: collectPhysical(db, dbPath),
      logical: collectLogical(db),
      realizedDedup: collectRealizedDedup(db),
      dedup: collectDedup(db, key, sampleLimit),
      chunkDedup: collectChunkDedup(db, key, sampleLimit),
      largest: collectLargest(db, opts.topN ?? 100),
    };
  } finally {
    db.close();
  }
}

export type { ProfileResult } from './types';
export { renderReports } from './report/markdown';
