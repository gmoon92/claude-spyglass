/**
 * Storage Profiler — 공용 타입 (단일 진실 소스)
 *
 * @description 수집기(collectors)가 채우고 리포트 렌더러(report)가 소비하는 데이터 형태.
 *   숫자는 모두 byte 단위(별도 명시 없으면). 측정 시각/환경은 ProfileResult.meta에.
 */

/** dbstat 기반 테이블/인덱스 물리 크기 1행. */
export interface PhysicalEntry {
  name: string;
  kind: 'table' | 'index' | 'other';
  bytes: number;
  pages: number;
}

/** DB 전체 물리 현황 — 논리 합과의 차이를 freelist로 설명. */
export interface PhysicalSummary {
  fileBytes: number; // main DB 파일 크기 (fs)
  walBytes: number; // -wal 파일 크기 (fs)
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  freelistBytes: number; // freelistCount * pageSize (회수 가능 추정)
  entries: PhysicalEntry[]; // bytes 내림차순
}

/** algo별 분해 (평문/zstd/암호화 비중 가시화). */
export interface AlgoBreakdown {
  algo: string; // 'plain' | 'zstd' | 'aes256gcm' | 'zstd+aes256gcm'
  rows: number;
  storedBytes: number; // 현재 컬럼에 저장된 바이트 (압축/암호화된 상태)
}

/** payload 보유 컬럼 1개의 논리 크기 요약. */
export interface ColumnLogical {
  table: string;
  column: string;
  rows: number;
  storedBytes: number; // SUM(length(col)) — 디스크상 실제 바이트
  rawBytes: number | null; // 알려진 원본 크기 합(payload_raw_size 있으면), 없으면 null
  maxStoredBytes: number;
  byAlgo: AlgoBreakdown[];
  /** requests.type / event_type 등 의미 단위 분해 (가능한 경우). */
  byCategory?: { category: string; rows: number; storedBytes: number }[];
}

/** 이미 실현된 dedup (system_prompts 처럼 CAS가 이미 적용된 영역). */
export interface RealizedDedup {
  table: string;
  logicalBytes: number; // 참조까지 펼친 논리 크기 (SUM(byte_size * ref_count))
  uniqueBytes: number; // 고유 본문 크기 (SUM(byte_size))
  savedBytes: number; // logical - unique
  savedPct: number;
  refCountMax: number;
  rows: number;
}

/** Axis A — 평문 기준 content dedup 측정 (이론적 CAS 상한). */
export interface DedupMeasure {
  table: string;
  column: string;
  measuredRows: number; // 실제 디코드/해시한 행 수
  totalRows: number; // 컬럼 전체 행 수
  sampled: boolean;
  encryptedRowsSkipped: number; // 키 없어 측정 불가(분모 제외)
  errorRowsSkipped: number;
  plaintextBytes: number; // 측정 행들의 평문 합
  uniqueBytes: number; // 고유 해시 기준 평문 합
  savedBytes: number; // plaintext - unique
  savedPct: number;
  uniqueRatio: number; // uniqueRows / measuredRows
}

/** Top-100 대형 레코드 1행. */
export interface LargestRecord {
  source: string; // 'request_payloads' 등
  id: string;
  storedBytes: number;
  algo: string;
  category: string | null; // type/event_type 등
  preview: string | null;
}

export interface ProfileMeta {
  dbPath: string;
  generatedAtMs: number;
  sampleLimit: number | null;
  hasEncryptionKey: boolean;
}

/**
 * Axis A' — 청크(sub-document) 단위 dedup.
 *
 * conversation payload는 append 구조라 document 전체는 절대 안 겹쳐도(0%) 내부
 * message/tool/system 블록은 대부분 재등장한다. CAS를 Git blob 단위로 적용했을 때의
 * 실제 절감을 측정한다 — document 단위 측정이 CAS 효과를 과소평가하는 맹점을 보정.
 */
export interface ChunkDedupMeasure {
  table: string;
  column: string;
  measuredRows: number; // 파싱·청킹에 성공한 행 수
  totalRows: number;
  sampled: boolean;
  parseFailedRows: number; // JSON 파싱 실패(분모 제외)
  encryptedRowsSkipped: number;
  chunkCount: number; // 추출된 전체 청크 수
  uniqueChunkCount: number;
  totalChunkBytes: number; // 전체 청크 평문 합
  uniqueChunkBytes: number; // 고유 청크 평문 합
  savedBytes: number; // total - unique
  savedPct: number; // CAS(청크) 적용 시 이론 절감률
  dupCountPct: number; // 중복 청크 비율(개수 기준)
}

export interface ProfileResult {
  meta: ProfileMeta;
  physical: PhysicalSummary;
  logical: ColumnLogical[];
  realizedDedup: RealizedDedup[];
  dedup: DedupMeasure[];
  chunkDedup: ChunkDedupMeasure[];
  largest: LargestRecord[];
}
