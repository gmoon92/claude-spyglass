/**
 * Storage Profiler — read-only DB 연결
 *
 * @description
 *   프로파일러는 절대 DB를 수정하지 않는다. 일반 `SpyglassDatabase`는 열 때
 *   마이그레이션 실행·chmod·WAL checkpoint(=쓰기)를 수행하므로 분석 용도로 쓰면 안 된다.
 *   대신 raw `Database`를 `readonly: true`로 열고 `PRAGMA query_only = 1`로 쓰기를 이중 차단한다.
 *
 * @dependencies bun:sqlite
 * @flow profiler/index.ts → openReadOnly() → collectors/*
 */

import { Database } from 'bun:sqlite';

/** 기본 DB 경로 — connection.ts와 동일 규칙(HOME 기반, 절대경로 하드코딩 금지). */
export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return `${env.HOME || env.USERPROFILE}/.spyglass/spyglass.db`;
}

/**
 * read-only 연결을 연다. 쓰기 시도는 `query_only`로 런타임 차단된다.
 * 호출자는 사용 후 `db.close()` 책임을 진다.
 */
export function openReadOnly(dbPath: string): Database {
  const db = new Database(dbPath, { readonly: true });
  // 마이그레이션/트리거가 끼어들지 못하도록 쓰기를 명시적으로 봉인.
  db.query('PRAGMA query_only = 1;').run();
  return db;
}
