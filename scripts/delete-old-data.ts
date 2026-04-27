#!/usr/bin/env bun
/**
 * 오래된 데이터 삭제 스크립트
 * 사용: bun run scripts/delete-old-data.ts [days]
 * 기본값: 3일 전 데이터 삭제
 */

import { Database } from 'bun:sqlite';
import { getDefaultDbPath } from '../packages/storage/src/connection';

const DAYS = parseInt(process.argv[2] || '2', 10);
const beforeTs = Date.now() - DAYS * 24 * 60 * 60 * 1000;
const beforeDate = new Date(beforeTs).toISOString();

console.log(`🗑️  ${DAYS}일 전 데이터 삭제`);
console.log(`   기준 시간: ${beforeDate}`);
console.log(`   기준 타임스탬프: ${beforeTs}`);

const dbPath = getDefaultDbPath();
console.log(`\n📁 데이터베이스: ${dbPath}`);

const db = new Database(dbPath);

// 현재 데이터 수 확인
const sessionCount = db.query('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
const requestCount = db.query('SELECT COUNT(*) as count FROM requests').get() as { count: number };
console.log(`\n📊 현재 데이터:`);
console.log(`   세션: ${sessionCount.count.toLocaleString()}개`);
console.log(`   요청: ${requestCount.count.toLocaleString()}개`);

// 삭제 대상 확인
const oldSessions = db.query('SELECT COUNT(*) as count FROM sessions WHERE started_at < ?').get(beforeTs) as { count: number };
const oldRequests = db.query('SELECT COUNT(*) as count FROM requests WHERE timestamp < ?').get(beforeTs) as { count: number };
console.log(`\n🎯 삭제 대상 (${DAYS}일 이전):`);
console.log(`   세션: ${oldSessions.count.toLocaleString()}개`);
console.log(`   요청: ${oldRequests.count.toLocaleString()}개`);

if (oldSessions.count === 0 && oldRequests.count === 0) {
  console.log('\n✅ 삭제할 데이터가 없습니다.');
  db.close();
  process.exit(0);
}

// 삭제 실행 (외래키 CASCADE로 인해 sessions 삭제 시 연결된 requests도 삭제됨)
console.log('\n⚠️  삭제를 시작합니다...');

const deleteSessionsResult = db.run('DELETE FROM sessions WHERE started_at < ?', beforeTs);
console.log(`   ✅ 세션 삭제: ${deleteSessionsResult.changes.toLocaleString()}개`);

// requests는 세션과 연결되지 않은 고아 데이터만 별도 삭제
const deleteRequestsResult = db.run('DELETE FROM requests WHERE timestamp < ?', beforeTs);
console.log(`   ✅ 요청 삭제: ${deleteRequestsResult.changes.toLocaleString()}개`);

// 삭제 후 데이터 수 확인
const remainingSessions = db.query('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
const remainingRequests = db.query('SELECT COUNT(*) as count FROM requests').get() as { count: number };
console.log(`\n📊 남은 데이터:`);
console.log(`   세션: ${remainingSessions.count.toLocaleString()}개`);
console.log(`   요청: ${remainingRequests.count.toLocaleString()}개`);

// WAL 체크포인트
db.run('PRAGMA wal_checkpoint(TRUNCATE);');

db.close();
console.log('\n✨ 완료!');
