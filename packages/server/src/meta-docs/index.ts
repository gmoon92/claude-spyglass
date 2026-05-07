/**
 * meta-docs 모듈 — 외부 진입점
 *
 * 외부에서는 이 barrel만 import:
 *   import { syncCwd, syncGlobalOnce, listMetaDocsWithUsage } from './meta-docs';
 */

export {
  scanRoot,
  scanGlobalUserDir,
  type MetaDocCandidate,
} from './scanner';

export {
  resolveProjectChain,
  normalizeCwd,
  type ProjectChain,
} from './resolver';

export {
  syncCwd,
  syncGlobalOnce,
  bootstrapSync,
  type SyncResult,
} from './synchronizer';
