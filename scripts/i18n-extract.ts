/**
 * i18n-extract.ts — 한국어 하드코딩 문자열 자동 추출 도구
 *
 * 사용법:
 *   bun run scripts/i18n-extract.ts [--target=web|tui|both] [--dry-run]
 *
 * 기능:
 *   - TypeScript Compiler API로 JS/TS/TSX 파일 파싱 (정규식 grep 금지)
 *   - 한글(가-힣) 포함 StringLiteral / NoSubstitutionTemplateLiteral / TemplateExpression / JSX text 추출
 *   - 파일명 휴리스틱으로 namespace(badges|request|session|ui|common) 결정
 *   - 기존 JSON에 신규 키만 머지 (기존 값 덮어쓰기 없음)
 *   - --dry-run: 파일 변경 없이 보고서만 출력
 *   - scripts/.i18n-report.json 에 상세 리포트 저장
 */

import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

// ────────────────────────────────────────────────────────────────────────────
// 설정 상수
// ────────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dir, '..');

/** 패키지별 소스 글로브 설정 */
const PACKAGE_CONFIGS = {
  web: {
    dirs: [path.join(PROJECT_ROOT, 'packages/web/assets/js')],
    extensions: ['.js'],
    localeDir: path.join(PROJECT_ROOT, 'packages/web/locales/ko'),
  },
  tui: {
    dirs: [path.join(PROJECT_ROOT, 'packages/tui/src')],
    extensions: ['.ts', '.tsx'],
    localeDir: path.join(PROJECT_ROOT, 'packages/tui/locales/ko'),
  },
} as const;

type PackageName = keyof typeof PACKAGE_CONFIGS;

/** 제외할 파일/디렉토리 패턴 */
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\/dist\//,
  /\/__tests__\//,
  /\.test\./,
  /\/i18n\./,
  /\/lang-switcher\./,
  /\/locales\//,
];

/** namespace 결정 휴리스틱 — 파일명에서 매핑 (긴 패턴 우선) */
const NS_RULES: Array<{ pattern: RegExp; ns: string }> = [
  { pattern: /badge|배지/i, ns: 'badges' },
  { pattern: /request|req|proxy/i, ns: 'request' },
  { pattern: /session|세션/i, ns: 'session' },
  { pattern: /ui|header|menu|nav|rail|bar|overlay|panel|strip/i, ns: 'ui' },
];
const NS_FALLBACK = 'common';
const VALID_NAMESPACES = ['badges', 'request', 'session', 'ui', 'common'] as const;
type Namespace = typeof VALID_NAMESPACES[number];

/** 보고서 저장 경로 */
const REPORT_PATH = path.join(PROJECT_ROOT, 'scripts/.i18n-report.json');

// ────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ────────────────────────────────────────────────────────────────────────────

interface ExtractedItem {
  file: string;
  line: number;
  key: string;
  value: string;
  namespace: Namespace;
  needsManual?: boolean; // template expression 등 보간 포함
  isConsoleArg?: boolean; // console.* 인자 후보
}

interface Report {
  generatedAt: string;
  target: string;
  dryRun: boolean;
  totalExtracted: number;
  filesScanned: number;
  mergedKeys: number;
  skippedKeys: number;
  needsManualCount: number;
  items: ExtractedItem[];
}

// ────────────────────────────────────────────────────────────────────────────
// 유틸리티 함수
// ────────────────────────────────────────────────────────────────────────────

/** 한글(가-힣) 1자 이상 포함 여부 */
function hasKorean(text: string): boolean {
  return /[가-힣]/.test(text);
}

/** 빈 문자열 또는 한글 없는 경우 스킵 */
function shouldSkip(text: string): boolean {
  return !text.trim() || !hasKorean(text);
}

/** 파일명으로 namespace 결정 */
function resolveNamespace(filePath: string): Namespace {
  const basename = path.basename(filePath, path.extname(filePath));
  for (const { pattern, ns } of NS_RULES) {
    if (pattern.test(basename)) return ns as Namespace;
  }
  return NS_FALLBACK;
}

/** 임시 키 생성: auto.{basename}.{index} */
function makeAutoKey(filePath: string, index: number): string {
  const basename = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `auto.${basename}.${index}`;
}

/** 제외 패턴 확인 */
function isExcluded(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((p) => p.test(filePath));
}

/** 디렉토리 재귀 탐색으로 파일 목록 수집 */
function collectFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      if (!isExcluded(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/** 노드가 import/require 경로인지 확인 */
function isImportPath(node: ts.StringLiteral): boolean {
  const parent = node.parent;
  // import 'xxx' / import from 'xxx'
  if (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) return true;
  // require('xxx')
  if (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'require' &&
    parent.arguments[0] === node
  ) {
    return true;
  }
  // export ... from 'xxx'
  if (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) return true;
  return false;
}

/** 노드가 console.* 호출의 인자인지 확인 */
function isConsoleArg(node: ts.Node): boolean {
  // 직접 부모 또는 조상이 console.xxx() 인지 확인
  let cur: ts.Node = node;
  while (cur.parent) {
    cur = cur.parent;
    if (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression) &&
      ts.isIdentifier(cur.expression.expression) &&
      cur.expression.expression.text === 'console'
    ) {
      return true;
    }
    // CallExpression 외 다른 구조면 중단
    if (
      ts.isStatement(cur) ||
      ts.isVariableDeclaration(cur) ||
      ts.isPropertyAssignment(cur) ||
      ts.isReturnStatement(cur)
    ) {
      break;
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// AST 파서 — 한국어 문자열 추출
// ────────────────────────────────────────────────────────────────────────────

interface ParseContext {
  sourceFile: ts.SourceFile;
  filePath: string;
  namespace: Namespace;
  items: ExtractedItem[];
  counterRef: { value: number };
}

/** StringLiteral 처리 */
function handleStringLiteral(node: ts.StringLiteral, ctx: ParseContext): void {
  const text = node.text;
  if (shouldSkip(text)) return;
  if (isImportPath(node)) return;

  const { line } = ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const key = makeAutoKey(ctx.filePath, ctx.counterRef.value++);
  ctx.items.push({
    file: ctx.filePath,
    line: line + 1,
    key,
    value: text,
    namespace: ctx.namespace,
    isConsoleArg: isConsoleArg(node),
  });
}

/** NoSubstitutionTemplateLiteral 처리 */
function handleNoSubstitutionTemplate(node: ts.NoSubstitutionTemplateLiteral, ctx: ParseContext): void {
  const text = node.text;
  if (shouldSkip(text)) return;

  const { line } = ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const key = makeAutoKey(ctx.filePath, ctx.counterRef.value++);
  ctx.items.push({
    file: ctx.filePath,
    line: line + 1,
    key,
    value: text,
    namespace: ctx.namespace,
    isConsoleArg: isConsoleArg(node),
  });
}

/** TemplateExpression 처리 — 보간이 있으므로 needsManual = true */
function handleTemplateExpression(node: ts.TemplateExpression, ctx: ParseContext): void {
  // head + middle + tail 조각을 합쳐서 한글 포함 여부 확인
  const parts: string[] = [node.head.text];
  for (const span of node.templateSpans) {
    parts.push(span.literal.text);
  }
  const combined = parts.join('${...}');
  if (!hasKorean(combined)) return;

  const { line } = ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const key = makeAutoKey(ctx.filePath, ctx.counterRef.value++);
  ctx.items.push({
    file: ctx.filePath,
    line: line + 1,
    key,
    value: combined,
    namespace: ctx.namespace,
    needsManual: true,
    isConsoleArg: isConsoleArg(node),
  });
}

/** JSXText 처리 */
function handleJsxText(node: ts.JsxText, ctx: ParseContext): void {
  const text = node.text.trim();
  if (shouldSkip(text)) return;

  const { line } = ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const key = makeAutoKey(ctx.filePath, ctx.counterRef.value++);
  ctx.items.push({
    file: ctx.filePath,
    line: line + 1,
    key,
    value: text,
    namespace: ctx.namespace,
  });
}

/** 재귀 AST 순회 */
function visit(node: ts.Node, ctx: ParseContext): void {
  if (ts.isStringLiteral(node)) {
    handleStringLiteral(node, ctx);
  } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
    handleNoSubstitutionTemplate(node, ctx);
  } else if (ts.isTemplateExpression(node)) {
    handleTemplateExpression(node, ctx);
    // TemplateExpression의 자식(head/spans)은 여기서 이미 처리했으므로
    // 자식 span 내부의 expression은 계속 방문 (중첩 템플릿 가능)
    for (const span of node.templateSpans) {
      visit(span.expression, ctx);
    }
    return; // head/tail 중복 방지
  } else if (ts.isJsxText(node)) {
    handleJsxText(node, ctx);
  }

  ts.forEachChild(node, (child) => visit(child, ctx));
}

/** 단일 파일 파싱 및 추출 */
function extractFromFile(filePath: string): ExtractedItem[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);

  const scriptKind =
    ext === '.tsx'
      ? ts.ScriptKind.TSX
      : ext === '.ts'
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes= */ true,
    scriptKind,
  );

  const ctx: ParseContext = {
    sourceFile,
    filePath,
    namespace: resolveNamespace(filePath),
    items: [],
    counterRef: { value: 0 },
  };

  visit(sourceFile, ctx);
  return ctx.items;
}

// ────────────────────────────────────────────────────────────────────────────
// JSON 머지 — 신규 키만 추가
// ────────────────────────────────────────────────────────────────────────────

interface MergeResult {
  added: number;
  skipped: number;
}

/** 기존 JSON 읽기 — 없으면 빈 객체 반환 */
function readLocaleJson(jsonPath: string): Record<string, unknown> {
  if (!fs.existsSync(jsonPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 중첩 키 설정 — "auto.stat-tooltip.0" → { auto: { "stat-tooltip": { "0": value } } }
 * needsManual=true 항목은 키 부여 없이 스킵 (이미 호출 전 필터됨)
 */
function setNestedKey(
  obj: Record<string, unknown>,
  keyPath: string,
  value: string,
): void {
  const parts = keyPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) {
      cur[p] = {};
    }
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) {
    cur[last] = value;
  }
}

/** 중첩 키 존재 확인 */
function hasNestedKey(obj: Record<string, unknown>, keyPath: string): boolean {
  const parts = keyPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null || !(p in cur)) return false;
    cur = cur[p];
  }
  return true;
}

/**
 * 네임스페이스별 아이템을 locale JSON에 머지
 * needsManual=true 항목은 키 부여하지 않음
 */
function mergeToLocale(
  items: ExtractedItem[],
  localeDir: string,
  dryRun: boolean,
): MergeResult {
  // namespace → 항목 그룹화
  const grouped = new Map<string, ExtractedItem[]>();
  for (const item of items) {
    if (!grouped.has(item.namespace)) grouped.set(item.namespace, []);
    grouped.get(item.namespace)!.push(item);
  }

  let added = 0;
  let skipped = 0;

  for (const [ns, nsItems] of grouped) {
    const jsonPath = path.join(localeDir, `${ns}.json`);
    const existing = readLocaleJson(jsonPath);

    for (const item of nsItems) {
      // needsManual=true → 자동 키 부여 금지, 보고서에만 기록
      if (item.needsManual) {
        skipped++;
        continue;
      }
      // key = "auto.{basename}.{index}" — namespace prefix 제외 (namespace는 파일명으로 분리됨)
      if (hasNestedKey(existing, item.key)) {
        skipped++;
        continue;
      }
      setNestedKey(existing, item.key, item.value);
      added++;
    }

    if (!dryRun && added > 0) {
      fs.mkdirSync(localeDir, { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    }
  }

  return { added, skipped };
}

// ────────────────────────────────────────────────────────────────────────────
// 콘솔 출력
// ────────────────────────────────────────────────────────────────────────────

function printItem(item: ExtractedItem): void {
  const tags: string[] = [];
  if (item.needsManual) tags.push('[MANUAL]');
  if (item.isConsoleArg) tags.push('[console]');
  const tagStr = tags.length ? ` ${tags.join(' ')}` : '';
  const relFile = path.relative(PROJECT_ROOT, item.file);
  console.log(
    `  ${relFile}:${item.line}  ${item.namespace}.${item.key}  →  "${item.value}"${tagStr}`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 메인 실행
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(): { target: 'web' | 'tui' | 'both'; dryRun: boolean } {
  const args = process.argv.slice(2);
  let target: 'web' | 'tui' | 'both' = 'both';
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--target=')) {
      const val = arg.split('=')[1];
      if (val === 'web' || val === 'tui' || val === 'both') {
        target = val;
      } else {
        console.error(`[ERROR] Unknown --target value: ${val} (choose web, tui, or both)`);
        process.exit(1);
      }
    }
  }
  return { target, dryRun };
}

function getPackages(target: 'web' | 'tui' | 'both'): PackageName[] {
  if (target === 'both') return ['web', 'tui'];
  return [target];
}

async function main(): Promise<void> {
  const { target, dryRun } = parseArgs();
  const packages = getPackages(target);

  console.log(`\n=== i18n-extract ===`);
  console.log(`target: ${target}  dryRun: ${dryRun}`);
  console.log('');


  const allItems: ExtractedItem[] = [];
  let totalFiles = 0;
  let totalMerged = 0;
  let totalSkipped = 0;

  for (const pkg of packages) {
    const config = PACKAGE_CONFIGS[pkg];
    const files: string[] = [];
    for (const dir of config.dirs) {
      files.push(...collectFiles(dir, config.extensions as unknown as string[]));
    }
    totalFiles += files.length;

    console.log(`[${pkg}] Scanning ${files.length} files...`);

    const pkgItems: ExtractedItem[] = [];
    for (const file of files) {
      try {
        const extracted = extractFromFile(file);
        pkgItems.push(...extracted);
      } catch (err) {
        console.warn(`  [WARN] Parse failed: ${path.relative(PROJECT_ROOT, file)} — ${String(err)}`);
      }
    }

    console.log(`  Extracted Korean items: ${pkgItems.length}`);

    // 항목 출력
    if (pkgItems.length > 0) {
      console.log('');
      for (const item of pkgItems) {
        printItem(item);
      }
      console.log('');
    }

    // 머지
    const { added, skipped } = mergeToLocale(pkgItems, config.localeDir, dryRun);
    totalMerged += added;
    totalSkipped += skipped;
    allItems.push(...pkgItems);

    if (dryRun) {
      console.log(`  [dry-run] To merge: ${added}, skipped (existing/manual): ${skipped}`);
    } else {
      console.log(`  [merge] Added: ${added}, skipped (existing/manual): ${skipped}`);
    }
  }

  // 요약
  const needsManualCount = allItems.filter((i) => i.needsManual).length;
  console.log('');
  console.log('─────────────────────────────────────────');
  console.log(`Total files:       ${totalFiles}`);
  console.log(`Total extracted:   ${allItems.length}`);
  console.log(`Merged keys:       ${totalMerged}`);
  console.log(`Skipped keys:      ${totalSkipped}`);
  console.log(`Needs manual:      ${needsManualCount} (templates with interpolation)`);
  if (dryRun) console.log('** dry-run mode: no file changes **');
  console.log('─────────────────────────────────────────');

  // 리포트 저장
  const report: Report = {
    generatedAt: new Date().toISOString(),
    target,
    dryRun,
    totalExtracted: allItems.length,
    filesScanned: totalFiles,
    mergedKeys: totalMerged,
    skippedKeys: totalSkipped,
    needsManualCount,
    items: allItems,
  };

  if (!dryRun) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    console.log(`Report saved: ${path.relative(PROJECT_ROOT, REPORT_PATH)}`);
  } else {
    // dry-run에서도 리포트는 저장 (파일 변경이 아니라 분석 결과이므로)
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    console.log(`Report saved (dry-run): ${path.relative(PROJECT_ROOT, REPORT_PATH)}`);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
