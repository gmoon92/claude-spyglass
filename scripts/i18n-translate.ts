#!/usr/bin/env bun
/**
 * i18n 자동 번역 스크립트
 * 사용: bun run scripts/i18n-translate.ts [--target=web|tui|both] [--langs=en,ja,zh] [--dry-run] [--apply]
 *
 * ko/*.json 의 한국어 항목을 Claude Haiku 모델로 자동 번역하여
 * en/ja/zh/*.json 에 머지 저장합니다.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────
// 상수 정의
// ─────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5';
const MAX_CONCURRENT = 4; // 동시 API 호출 최대 수
const MAX_RETRIES = 1;    // 실패 시 재시도 횟수

/** 지원 언어 → 언어명 매핑 */
const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
};

/** 지원 패키지 */
const ALL_PACKAGES = ['web', 'tui'] as const;
type Package = typeof ALL_PACKAGES[number];

/** 처리 결과 행 */
interface ResultRow {
  pkg: Package;
  lang: string;
  ns: string;
  candidates: number;
  translated: number;
  skipped: number;
  errors: number;
}

// ─────────────────────────────────────────────
// 인자 파싱
// ─────────────────────────────────────────────

function parseArgs(): {
  packages: Package[];
  langs: string[];
  dryRun: boolean;
} {
  const args = process.argv.slice(2);

  // --target
  const targetArg = args.find(a => a.startsWith('--target='));
  const targetVal = targetArg ? targetArg.split('=')[1] : 'both';
  const packages: Package[] =
    targetVal === 'both'
      ? [...ALL_PACKAGES]
      : ALL_PACKAGES.filter(p => p === targetVal);

  if (packages.length === 0) {
    console.error(`Error: Unknown --target value '${targetVal}'. Choose web, tui, or both.`);
    process.exit(1);
  }

  // --langs
  const langsArg = args.find(a => a.startsWith('--langs='));
  const langsVal = langsArg ? langsArg.split('=')[1] : 'en,ja,zh';
  const langs = langsVal.split(',').map(l => l.trim()).filter(l => l in LANG_NAMES);

  if (langs.length === 0) {
    console.error(`Error: No valid language. Choose en, ja, or zh.`);
    process.exit(1);
  }

  // --dry-run / --apply
  const dryRun = !args.includes('--apply');

  return { packages, langs, dryRun };
}

// ─────────────────────────────────────────────
// JSON 파일 유틸
// ─────────────────────────────────────────────

/** JSON 파일을 읽어 Record 반환. 파일 없거나 비어 있으면 {} */
function readJson(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw || raw === '') return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** JSON 파일을 2-space indent로 저장 */
function writeJson(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ─────────────────────────────────────────────
// 평탄화 / 복원
// ─────────────────────────────────────────────

/**
 * 중첩 객체를 dot-notation 평탄 키로 변환
 * 예: { auto: { x: ['v'] } } → { 'auto.x.0': 'v' }
 */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[fullKey] = value;
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'string') {
          result[`${fullKey}.${i}`] = item;
        } else if (typeof item === 'object' && item !== null) {
          Object.assign(result, flatten(item as Record<string, unknown>, `${fullKey}.${i}`));
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flatten(value as Record<string, unknown>, fullKey));
    }
  }
  return result;
}

/**
 * 평탄 키를 다시 중첩 구조로 복원
 * 숫자 키가 연속되면 배열로 복원
 */
function unflatten(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [flatKey, value] of Object.entries(flat)) {
    const parts = flatKey.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const nextPart = parts[i + 1];
      const isNextIndex = /^\d+$/.test(nextPart);
      if (current[part] === undefined) {
        current[part] = isNextIndex ? [] : {};
      }
      current = current[part];
    }
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
  }
  return result;
}

// ─────────────────────────────────────────────
// Placeholder 검증
// ─────────────────────────────────────────────

/** 문자열에서 {var} 형태의 플레이스홀더를 모두 추출 */
function extractPlaceholders(str: string): string[] {
  return [...str.matchAll(/\{(\w+)\}/g)].map(m => m[0]);
}

/**
 * 번역 결과에서 플레이스홀더가 모두 보존되는지 확인
 * 보존 실패 시 해당 키를 제외하고 경고를 출력
 */
function validatePlaceholders(
  source: Record<string, string>,
  translated: Record<string, string>,
): { valid: Record<string, string>; warnings: string[] } {
  const valid: Record<string, string> = {};
  const warnings: string[] = [];

  for (const [key, srcValue] of Object.entries(source)) {
    const tgtValue = translated[key];
    if (tgtValue === undefined) continue;

    const srcPlaceholders = extractPlaceholders(srcValue);
    const tgtPlaceholders = extractPlaceholders(tgtValue);

    const missing = srcPlaceholders.filter(p => !tgtPlaceholders.includes(p));
    if (missing.length > 0) {
      warnings.push(`  [warn] Key '${key}': placeholders ${missing.join(', ')} missing — skipped`);
    } else {
      valid[key] = tgtValue;
    }
  }

  return { valid, warnings };
}

// ─────────────────────────────────────────────
// 한국어 판별
// ─────────────────────────────────────────────

/** 문자열에 한국어가 포함되어 있는지 확인 */
function containsKorean(str: string): boolean {
  return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(str);
}

// ─────────────────────────────────────────────
// 번역 대상 키 판별
// ─────────────────────────────────────────────

/**
 * 소스(ko) flat과 대상(lang) flat을 비교해
 * 번역이 필요한 키만 반환
 */
function findMissingKeys(
  source: Record<string, string>,
  target: Record<string, string>,
): Record<string, string> {
  const missing: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    // 비어 있거나 한국어가 그대로이면 번역 필요
    if (!existing || existing.trim() === '' || containsKorean(existing)) {
      missing[key] = value;
    }
  }
  return missing;
}

// ─────────────────────────────────────────────
// Claude Haiku API 호출
// ─────────────────────────────────────────────

/**
 * 단일 namespace의 flat 키-값을 지정 언어로 번역 요청
 * JSON 응답을 파싱하여 반환 (실패 시 null)
 */
async function translateWithClaude(
  client: Anthropic,
  langName: string,
  keysToTranslate: Record<string, string>,
  retryLeft = MAX_RETRIES,
): Promise<Record<string, string> | null> {
  const systemPrompt =
    `You are a UI translator for a developer tool dashboard. ` +
    `Translate Korean UI strings to ${langName}. ` +
    `Preserve placeholders like {var} exactly as-is. ` +
    `Return strict JSON with the same keys and translated values. ` +
    `Keep translations terse and professional. ` +
    `Do NOT include any explanation — respond ONLY with valid JSON.`;

  const userMessage =
    `Translate the following Korean UI strings to ${langName}.\n` +
    `Return ONLY a JSON object with the same keys and translated values.\n\n` +
    `Input:\n${JSON.stringify(keysToTranslate, null, 2)}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // 텍스트 블록 추출
    const textContent = response.content.find(b => b.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text block in response');
    }

    // JSON 파싱 (코드 블록 래퍼 제거 후 시도)
    const raw = textContent.text.trim();
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(jsonStr) as Record<string, string>;
  } catch (err) {
    if (retryLeft > 0) {
      console.warn(`  [retry] ${langName} — ${(err as Error).message}`);
      return translateWithClaude(client, langName, keysToTranslate, retryLeft - 1);
    }
    console.error(`  [error] ${langName} translation failed: ${(err as Error).message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// Promise 청크 분할 실행
// ─────────────────────────────────────────────

/**
 * tasks 배열을 chunkSize 단위로 나눠 순차 실행
 * 각 청크 내부는 병렬 처리
 */
async function runInChunks<T>(
  tasks: (() => Promise<T>)[],
  chunkSize: number,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn => fn()));
    results.push(...chunkResults);
  }
  return results;
}

// ─────────────────────────────────────────────
// namespace 처리
// ─────────────────────────────────────────────

interface NsTaskInput {
  pkg: Package;
  ns: string;
  lang: string;
  koFlat: Record<string, string>;
  localesDir: string;
  dryRun: boolean;
  client: Anthropic;
}

/** 하나의 (pkg × ns × lang) 조합을 처리하고 ResultRow 반환 */
async function processNamespace({
  pkg,
  ns,
  lang,
  koFlat,
  localesDir,
  dryRun,
  client,
}: NsTaskInput): Promise<ResultRow> {
  const row: ResultRow = { pkg, lang, ns, candidates: 0, translated: 0, skipped: 0, errors: 0 };

  // 대상 언어 파일 읽기
  const targetPath = path.join(localesDir, lang, `${ns}.json`);
  const targetFlat = flatten(readJson(targetPath));

  // 번역 필요 키 판별
  const missing = findMissingKeys(koFlat, targetFlat);
  row.candidates = Object.keys(missing).length;

  if (row.candidates === 0) {
    return row; // 번역 불필요
  }

  if (dryRun) {
    // dry-run: API 호출 없이 카운트만
    row.skipped = row.candidates;
    return row;
  }

  // 실제 번역 API 호출
  const langName = LANG_NAMES[lang];
  const translated = await translateWithClaude(client, langName, missing);

  if (translated === null) {
    // 전체 ns 스킵
    row.errors = row.candidates;
    return row;
  }

  // 플레이스홀더 검증
  const { valid, warnings } = validatePlaceholders(missing, translated);
  warnings.forEach(w => console.warn(w));
  row.skipped = row.candidates - Object.keys(valid).length;
  row.errors = 0;

  if (Object.keys(valid).length === 0) {
    return row;
  }

  // 기존 대상 파일에 머지하여 저장
  const existingTarget = readJson(targetPath);
  const existingFlat = flatten(existingTarget);
  const mergedFlat = { ...existingFlat, ...valid };
  const mergedNested = unflatten(mergedFlat);

  writeJson(targetPath, mergedNested);
  row.translated = Object.keys(valid).length;

  return row;
}

// ─────────────────────────────────────────────
// 보고 출력
// ─────────────────────────────────────────────

/** 결과 테이블을 콘솔에 출력 */
function printReport(rows: ResultRow[]): void {
  const col = (s: string, w: number) => s.padEnd(w);

  console.log('\n');
  console.log(
    col('PKG', 6) +
    col('LANG', 6) +
    col('NS', 14) +
    col('CANDIDATES', 12) +
    col('TRANSLATED', 12) +
    col('SKIPPED', 10) +
    'ERRORS',
  );
  console.log('─'.repeat(68));

  for (const r of rows) {
    console.log(
      col(r.pkg, 6) +
      col(r.lang, 6) +
      col(r.ns, 14) +
      col(String(r.candidates), 12) +
      col(String(r.translated), 12) +
      col(String(r.skipped), 10) +
      r.errors,
    );
  }

  console.log('─'.repeat(68));

  // 합계
  const sum = rows.reduce(
    (acc, r) => ({
      candidates: acc.candidates + r.candidates,
      translated: acc.translated + r.translated,
      skipped: acc.skipped + r.skipped,
      errors: acc.errors + r.errors,
    }),
    { candidates: 0, translated: 0, skipped: 0, errors: 0 },
  );
  console.log(
    col('TOTAL', 28) +
    col(String(sum.candidates), 12) +
    col(String(sum.translated), 12) +
    col(String(sum.skipped), 10) +
    sum.errors,
  );
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  const { packages, langs, dryRun } = parseArgs();

  console.log('╔══════════════════════════════════════╗');
  console.log('║     i18n auto-translation script     ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Mode     : ${dryRun ? 'dry-run (no API call)' : 'apply (write translations)'}`);
  console.log(`Packages : ${packages.join(', ')}`);
  console.log(`Languages: ${langs.join(', ')}`);
  console.log(`Model    : ${MODEL}`);
  console.log('');

  // ANTHROPIC_API_KEY 체크 (--apply 시 필수)
  let client: Anthropic | null = null;
  if (!dryRun) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(
        'Error: ANTHROPIC_API_KEY environment variable is not set.\n' +
        'Set it before running:\n' +
        '  export ANTHROPIC_API_KEY="sk-ant-..."',
      );
      process.exit(1);
    }
    client = new Anthropic({ apiKey });
  }

  const projectRoot = path.resolve(import.meta.dir, '..');

  // 모든 작업 수집
  const tasks: (() => Promise<ResultRow>)[] = [];

  for (const pkg of packages) {
    const localesDir = path.join(projectRoot, 'packages', pkg, 'locales');
    const koDir = path.join(localesDir, 'ko');

    // ko/*.json 파일 목록
    let nsFiles: string[];
    try {
      nsFiles = fs.readdirSync(koDir).filter(f => f.endsWith('.json'));
    } catch {
      console.warn(`Warning: cannot read ${koDir} directory. Skipping.`);
      continue;
    }

    for (const nsFile of nsFiles) {
      const ns = nsFile.replace('.json', '');
      const koData = readJson(path.join(koDir, nsFile));
      const koFlat = flatten(koData);

      // ko 파일이 비어 있으면 스킵
      if (Object.keys(koFlat).length === 0) {
        continue;
      }

      for (const lang of langs) {
        tasks.push(() =>
          processNamespace({
            pkg,
            ns,
            lang,
            koFlat,
            localesDir,
            dryRun,
            client: client!,
          }),
        );
      }
    }
  }

  if (tasks.length === 0) {
    console.log('Nothing to translate. (all ko/*.json files are empty)');
    console.log('\n dry-run result: 0 candidates — normal operation confirmed');
    return;
  }

  // 청크 단위 병렬 실행
  const results = await runInChunks(tasks, MAX_CONCURRENT);

  // 보고
  printReport(results);

  if (dryRun) {
    const total = results.reduce((a, r) => a + r.candidates, 0);
    console.log(`\n[dry-run] Total translation candidates: ${total}. Use --apply to write translations.`);
    console.log('  e.g.: bun run scripts/i18n-translate.ts --target=both --apply');
  } else {
    const total = results.reduce((a, r) => a + r.translated, 0);
    console.log(`\n[apply] Total translations completed: ${total}.`);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
