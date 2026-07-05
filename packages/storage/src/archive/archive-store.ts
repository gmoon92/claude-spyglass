/**
 * archive-store — Warm Archive 본문 저장소 (날짜단위 압축파일, roadmap Phase 5)
 *
 * @description
 *   이주된 행 '본문'을 날짜·테이블 단위 JSONL+zstd 파일로 저장/조회한다. 위치 인덱스는
 *   archive_index(SQLite)가 SSoT이고, 이 스토어는 본문 파일만 다룬다(ArtifactStore와 대칭 선례).
 *
 *   원자성(ADR A8): 파일은 tmp write → rename(원자 교체)로만 갱신 → 부분쓰기 노출 없음.
 *   append 시맨틱: 같은 날 여러 이주 배치가 누적될 수 있어 기존+신규를 재작성한다. 파일에
 *   중복 라인이 생기더라도 load의 진실은 archive_index(row_id) — 중복은 안전측(손실 0)이다.
 *
 * @dependencies node:fs, node:path, Bun.zstd
 * @flow write: migrate-to-archive → appendDay / read: partition-router.loadArchive → readDay
 *       gc(retention 경계): → remove
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** 교체 가능한 archive 본문 저장 계약. archiveFile은 파일명(디렉토리 제외). */
export interface ArchiveStore {
  /** JSONL 라인들을 파일에 누적(기존 있으면 append). 원자적 교체. */
  appendDay(archiveFile: string, lines: string[]): void;
  /** 파일의 모든 JSONL 라인(zstd 해제). 미존재 시 []. */
  readDay(archiveFile: string): string[];
  /** 파일 존재 여부. */
  exists(archiveFile: string): boolean;
  /** 파일 삭제(retention 경계 GC). 미존재는 no-op. */
  remove(archiveFile: string): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 파일시스템 기반 ArchiveStore. `~/.spyglass/archive/` 같은 디렉토리를 주입받는다.
 *
 * @param dir archive 파일 디렉토리(절대경로). 없으면 write 시 생성.
 */
export class FileArchiveStore implements ArchiveStore {
  constructor(private readonly dir: string) {}

  private path(archiveFile: string): string {
    return join(this.dir, archiveFile);
  }

  appendDay(archiveFile: string, lines: string[]): void {
    if (lines.length === 0) return;
    mkdirSync(this.dir, { recursive: true });
    const existing = this.exists(archiveFile) ? this.readDay(archiveFile) : [];
    const text = [...existing, ...lines].join('\n') + '\n';
    const compressed = Bun.zstdCompressSync(encoder.encode(text));
    // 원자적 교체: 임시파일 write → rename. 부분쓰기가 최종 파일에 노출되지 않는다.
    const tmp = this.path(`${archiveFile}.tmp`);
    writeFileSync(tmp, compressed);
    renameSync(tmp, this.path(archiveFile));
  }

  readDay(archiveFile: string): string[] {
    if (!this.exists(archiveFile)) return [];
    const compressed = readFileSync(this.path(archiveFile));
    const text = decoder.decode(Bun.zstdDecompressSync(compressed));
    return text.split('\n').filter((l) => l.length > 0);
  }

  exists(archiveFile: string): boolean {
    return existsSync(this.path(archiveFile));
  }

  remove(archiveFile: string): void {
    if (this.exists(archiveFile)) unlinkSync(this.path(archiveFile));
  }
}
