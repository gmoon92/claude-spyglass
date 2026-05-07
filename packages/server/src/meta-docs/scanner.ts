/**
 * meta-docs 모듈 — 메타 문서 디스크 스캐너
 *
 * 책임:
 *  - 주어진 디렉토리(`<root>/.claude/{agents,skills,commands}`)를 훑어
 *    .md 파일을 찾고 frontmatter를 파싱하여 카탈로그 후보(MetaDocCandidate) 배열을 만든다.
 *  - claude-code의 markdownConfigLoader와 동일한 디렉토리 규칙을 따르되,
 *    spyglass는 카탈로그 표기만 필요하므로 plugin / mcp 처리는 생략 (phase 2).
 *
 * 입력 디렉토리 규약 (claude-code 호환):
 *  - agents:   `<root>/.claude/agents/<name>.md`
 *  - skills:   `<root>/.claude/skills/<name>/SKILL.md` (단일 파일은 무시 — claude-code가 거부)
 *  - commands: `<root>/.claude/commands/<name>.md` (legacy)
 *
 * frontmatter:
 *  - YAML 부분 집합. `name`, `description` 필수. 그 외 필드는 frontmatter_json으로 그대로 보존.
 *  - 명세는 claude-code의 utils/frontmatterParser.ts에 있으나 우리는 단순 파서로 충분
 *    (정의가 valid YAML이라는 가정 하에 동작; 잘못된 frontmatter는 silently skip).
 *
 * 외부 노출:
 *  - scanRoot(rootDir, source): MetaDocCandidate[]
 *  - scanGlobalUserDir(): MetaDocCandidate[] (~/.claude 스캔)
 *
 * 호출자: synchronizer.ts
 *
 * 의존성: 표준 fs/path/os만. claude-code 코드에 의존 안 함 (별도 프로세스로 동작 가능).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { MetaDocSource, MetaDocType } from '@spyglass/storage';

/** 스캐너가 발견한 한 정의. synchronizer가 그대로 upsert에 넘긴다. */
export interface MetaDocCandidate {
  type: MetaDocType;
  name: string;
  source: MetaDocSource;
  /** project=git root realpath, user=~/.claude 절대경로, built-in=null */
  source_root: string | null;
  file_path: string;
  description: string | null;
  user_invocable: boolean;
  /** frontmatter 원본 (간이 파서 결과) — JSON 직렬화 형태로 보존. */
  frontmatter_json: string | null;
}

const SUBDIRS: Array<{ sub: 'agents' | 'skills' | 'commands'; type: MetaDocType }> = [
  { sub: 'agents',   type: 'agent' },
  { sub: 'skills',   type: 'skill' },
  { sub: 'commands', type: 'command' },
];

/**
 * `<root>/.claude/{agents,skills,commands}` 세 디렉토리를 모두 훑어 후보를 모은다.
 *
 * @param root        스캔의 루트 (project면 git root, user면 `~/.claude`의 부모인 `~/`).
 *                    내부에서 `<root>/.claude/<sub>` 형태로 펼친다.
 * @param source      이 root가 속하는 source 종류 (DB의 source 컬럼에 들어감).
 * @param source_root DB에 저장될 source_root 값. project면 root realpath, user면 ~/.claude 절대경로.
 *                    호출자가 이미 realpath 정규화한 값을 넘긴다고 가정.
 */
export function scanRoot(
  root: string,
  source: MetaDocSource,
  source_root: string | null,
): MetaDocCandidate[] {
  const out: MetaDocCandidate[] = [];
  for (const { sub, type } of SUBDIRS) {
    const dir = join(root, '.claude', sub);
    if (!isDirectory(dir)) continue;
    out.push(...scanSubdir(dir, type, source, source_root));
  }
  return out;
}

/**
 * 글로벌 `~/.claude/{agents,skills,commands}` 스캔.
 * 데몬 부팅 시 1회 + lazy resolve 시 재호출됨 (synchronizer가 throttle).
 */
export function scanGlobalUserDir(): MetaDocCandidate[] {
  const root = homedir();
  const userClaude = join(root, '.claude');
  if (!isDirectory(userClaude)) return [];
  // user는 root가 ~/이지만 source_root는 ~/.claude 자체로 저장 (project와의 충돌 방지)
  return scanRoot(root, 'userSettings', userClaude);
}

// =============================================================================
// 내부 — 서브디렉토리별 파싱
// =============================================================================

function scanSubdir(
  dir: string,
  type: MetaDocType,
  source: MetaDocSource,
  source_root: string | null,
): MetaDocCandidate[] {
  const out: MetaDocCandidate[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }

    // skills는 SKILL.md를 가진 디렉토리만 인정 (claude-code 규칙)
    if (type === 'skill') {
      if (!st.isDirectory()) continue;
      const skillFile = join(full, 'SKILL.md');
      if (!isFile(skillFile)) continue;
      const cand = parseFile(skillFile, type, source, source_root, entry);
      if (cand) out.push(cand);
      continue;
    }

    // agents/commands는 단일 .md 파일
    if (!st.isFile() || !entry.endsWith('.md')) continue;
    const nameFromFile = entry.replace(/\.md$/, '');
    const cand = parseFile(full, type, source, source_root, nameFromFile);
    if (cand) out.push(cand);
  }
  return out;
}

function parseFile(
  filePath: string,
  type: MetaDocType,
  source: MetaDocSource,
  source_root: string | null,
  fallbackName: string,
): MetaDocCandidate | null {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const { frontmatter, body } = splitFrontmatter(content);
  const name = (typeof frontmatter.name === 'string' && frontmatter.name.trim())
    || fallbackName;

  const description = (typeof frontmatter.description === 'string' && frontmatter.description.trim())
    || extractFirstHeading(body);

  const userInvocable = type === 'command'
    || frontmatter['user-invocable'] === true
    || frontmatter['user-invocable'] === 'true';

  return {
    type,
    name: name.trim(),
    source,
    source_root,
    file_path: filePath,
    description: description ?? null,
    user_invocable: !!userInvocable,
    frontmatter_json: Object.keys(frontmatter).length
      ? safeStringify(frontmatter)
      : null,
  };
}

// =============================================================================
// 미니 frontmatter 파서
// =============================================================================
// YAML 전체를 파싱하지 않고 흔한 형태(`key: value`, `key: "..."`, `key: [a, b]`)만 처리.
// 복잡한 YAML이 들어오면 raw 문자열로 보존 — UI에서 description만 노출하면 충분하다.

function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = text.replace(/^﻿/, '');
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { frontmatter: {}, body: trimmed };
  const fmText = trimmed.slice(3, end).replace(/^\r?\n/, '');
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  return { frontmatter: parseSimpleYaml(fmText), body };
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val: string = m[2].trim();

    // 인라인 배열 [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      out[key] = inner.length
        ? inner.split(',').map(s => stripQuotes(s.trim()))
        : [];
      continue;
    }

    // bool / number 일부 처리
    if (val === 'true')  { out[key] = true;  continue; }
    if (val === 'false') { out[key] = false; continue; }
    if (val === 'null' || val === '~' || val === '') { out[key] = null; continue; }
    if (/^-?\d+$/.test(val)) { out[key] = parseInt(val, 10); continue; }

    out[key] = stripQuotes(val);
  }
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function extractFirstHeading(body: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#+\s+(.+)$/);
    if (h) return h[1].trim().slice(0, 200);
    return line.slice(0, 200);
  }
  return null;
}

function safeStringify(o: unknown): string {
  try {
    return JSON.stringify(o);
  } catch {
    return '{}';
  }
}

// =============================================================================
// 파일시스템 헬퍼
// =============================================================================

function isDirectory(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}

// 외부에서 basename이 필요한 경우 대비 re-export (synchronizer가 사용할 수 있음)
export { basename };
