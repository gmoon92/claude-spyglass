/**
 * 서버 런타임 설정 — 환경변수에서 PORT/HOST/DB_PATH 결정.
 *
 * 변경 이유: 환경변수 키·기본값·디폴트 설정 변경 시 한 곳만 수정.
 */

import { getDefaultDbPath } from '@spyglass/storage';

/** 기본 포트 */
export const DEFAULT_PORT = 9999;

/** 환경변수에서 설정 */
export const PORT = parseInt(process.env.SPGLASS_PORT || `${DEFAULT_PORT}`, 10);
export const HOST = process.env.SPGLASS_HOST || '127.0.0.1';
export const DB_PATH = process.env.SPGLASS_DB_PATH || getDefaultDbPath();
