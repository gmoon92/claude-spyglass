/**
 * scanner.test.ts — scanRoot / scanGlobalUserDir + 미니 frontmatter 파서 특성화 테스트 (T05).
 *
 * @description
 *   현재 프로덕션 동작을 그대로 고정하는 characterization test.
 *   패키지 추출(T06) 전 안전망 확보가 목적이므로, 버그처럼 보여도 동작을 바꾸지
 *   않고 현재 출력을 기대값으로 못박는다.
 *
 *   내부 파서(splitFrontmatter / parseSimpleYaml / extractFirstHeading)는 export되지
 *   않으므로, 공개 표면 scanRoot를 통해 .claude/{agents,skills,commands}에 .md를
 *   배치하여 간접 특성화한다(미니 YAML의 BOM·CRLF·배열·bool·따옴표 엣지 포함).
 *
 *   격리 전략:
 *     - scanRoot는 root를 명시 인자로 받으므로 homedir mock 불필요. tmp dir만 사용.
 *     - scanGlobalUserDir만 homedir()를 쓰므로 mock.module로 교체.
 *     - tmp 디렉토리는 realpathSync로 정규화(macOS /tmp → /private/tmp).
 *
 * @see packages/meta-docs/src/scanner.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realOs from 'node:os';

let FAKE_HOME = realOs.homedir();
mock.module('node:os', () => ({ ...realOs, homedir: () => FAKE_HOME }));

const { scanRoot, scanGlobalUserDir } = await import('../scanner');

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

let ROOT: string; // realpath 정규화된 tmp 스캔 루트

function writeFile(rel: string, content: string): string {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

beforeEach(() => {
  ROOT = fs.realpathSync(fs.mkdtempSync('/tmp/spyglassScanner'));
});

afterEach(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

afterAll(() => { FAKE_HOME = realOs.homedir(); });

// =============================================================================
// scanRoot — 디렉토리 규칙 / 엣지
// =============================================================================

describe('scanRoot — 디렉토리 규칙', () => {
  it('.claude 서브디렉토리 전무 → 빈 배열', () => {
    expect(scanRoot(ROOT, 'projectSettings', ROOT)).toEqual([]);
  });

  it('agent .md 1개 — name/description/source 매핑', () => {
    writeFile('.claude/agents/helper.md', '---\nname: helper\ndescription: A helper agent\n---\nbody\n');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.type).toBe('agent');
    expect(r.name).toBe('helper');
    expect(r.description).toBe('A helper agent');
    expect(r.source).toBe('projectSettings');
    expect(r.source_root).toBe(ROOT);
    expect(r.file_path).toBe(path.join(ROOT, '.claude', 'agents', 'helper.md'));
    // agent는 user_invocable 기본 false
    expect(r.user_invocable).toBe(false);
  });

  it('agents 디렉토리에서 .md 아닌 파일은 무시', () => {
    writeFile('.claude/agents/readme.txt', 'not markdown');
    writeFile('.claude/agents/a.md', '---\nname: a\n---\n');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows.map(r => r.name)).toEqual(['a']);
  });

  it('skill — SKILL.md 가진 디렉토리만 인정', () => {
    // 유효: skills/good/SKILL.md
    writeFile('.claude/skills/good/SKILL.md', '---\nname: good-skill\ndescription: d\n---\n');
    // 무효: skills/bad/README.md (SKILL.md 없음)
    writeFile('.claude/skills/bad/README.md', '# nope');
    // 무효: skills/single.md (디렉토리 아님)
    writeFile('.claude/skills/single.md', '---\nname: x\n---\n');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows.map(r => r.name)).toEqual(['good-skill']);
    expect(rows[0].type).toBe('skill');
  });

  it('command — type=command는 user_invocable 항상 true', () => {
    writeFile('.claude/commands/deploy.md', '---\nname: deploy\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows[0].type).toBe('command');
    // 현재 동작 고정: command는 frontmatter와 무관하게 user_invocable=true (scanner.ts:156)
    expect(rows[0].user_invocable).toBe(true);
  });

  it('frontmatter name 없으면 파일명(확장자 제거)으로 폴백', () => {
    writeFile('.claude/agents/fallbackname.md', '---\ndescription: no name field\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows[0].name).toBe('fallbackname');
  });

  it('frontmatter name이 빈 문자열/공백 → 파일명 폴백', () => {
    writeFile('.claude/agents/blank.md', '---\nname: "   "\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // 현재 동작 고정: trim()이 falsy → fallbackName 사용
    expect(rows[0].name).toBe('blank');
  });

  it('세 서브디렉토리 모두 스캔 — agents → skills → commands 순', () => {
    writeFile('.claude/agents/ag.md', '---\nname: ag\n---\n');
    writeFile('.claude/skills/sk/SKILL.md', '---\nname: sk\n---\n');
    writeFile('.claude/commands/cm.md', '---\nname: cm\n---\n');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // SUBDIRS 순서 고정: agents, skills, commands (scanner.ts:48-52)
    expect(rows.map(r => r.type)).toEqual(['agent', 'skill', 'command']);
  });
});

// =============================================================================
// frontmatter 파서 — BOM / CRLF / 따옴표 / 배열 / bool / null (간접: frontmatter_json + description)
// =============================================================================

describe('scanRoot — frontmatter 파서 엣지', () => {
  it('frontmatter 없음 — body 첫 줄/헤딩을 description으로', () => {
    writeFile('.claude/agents/noyaml.md', '# First Heading\n\nrest');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // 현재 동작 고정: frontmatter 없으면 frontmatter_json=null, description=첫 헤딩 텍스트
    expect(rows[0].description).toBe('First Heading');
    expect(rows[0].frontmatter_json).toBeNull();
  });

  it('description 없을 때 body 첫 비공백 줄(헤딩 아님)을 그대로 사용', () => {
    writeFile('.claude/agents/plainfirst.md', '---\nname: pf\n---\nJust a plain first line\nmore');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // extractFirstHeading: 헤딩 매치 안 되면 첫 줄 200자 슬라이스 반환 (scanner.ts:230-238)
    expect(rows[0].description).toBe('Just a plain first line');
  });

  it('BOM(\\uFEFF) 선두 — 정상 파싱', () => {
    writeFile('.claude/agents/bom.md', '﻿---\nname: bomname\ndescription: bom desc\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // 현재 동작 고정: splitFrontmatter가 선두 BOM 제거 후 '---' 인식 (scanner.ts:181)
    expect(rows[0].name).toBe('bomname');
    expect(rows[0].description).toBe('bom desc');
  });

  it('CRLF 개행 — 모든 key가 LF와 동일하게 파싱 (닫는 fence 직전 마지막 key 포함)', () => {
    writeFile('.claude/agents/crlf.md', '---\r\nname: crlfname\r\ndescription: crlf desc\r\n---\r\nbody line\r\n');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // parseSimpleYaml이 라인 분할 시 trailing '\r'을 제거하므로 마지막 key(description)도
    // LF 입력과 동일하게 파싱된다. body 첫 줄로 폴백하지 않는다.
    expect(rows[0].name).toBe('crlfname');
    expect(rows[0].description).toBe('crlf desc');
    // 값에 trailing '\r'이 남지 않는지 frontmatter_json으로 검증
    expect(rows[0].frontmatter_json).toBe(JSON.stringify({ name: 'crlfname', description: 'crlf desc' }));
  });

  it('CRLF+LF 혼합 개행 — 두 스타일 모두 정상 파싱', () => {
    // name은 CRLF, description은 LF로 종료
    writeFile('.claude/agents/mixed.md', '---\r\nname: mixedname\ndescription: mixed desc\r\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows[0].name).toBe('mixedname');
    expect(rows[0].description).toBe('mixed desc');
  });

  it('CRLF + 마지막 줄 개행 없음 — 마지막 key 보존', () => {
    // 닫는 fence 뒤 body가 개행으로 끝나지 않음
    writeFile('.claude/agents/noeol.md', '---\r\nname: noeolname\r\ndescription: noeol desc\r\n---\r\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows[0].name).toBe('noeolname');
    expect(rows[0].description).toBe('noeol desc');
  });

  it('값 내부 \\r (개행 아님) — 라인 끝의 \\r만 제거되고 내부 텍스트는 보존', () => {
    // 라인 종료자가 아닌 CR은 값에 포함된 것으로 간주(트레일링만 정리). 여기선 trailing \r만 제거.
    writeFile('.claude/agents/innercr.md', '---\nname: innername\ndescription: a value\r\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows[0].name).toBe('innername');
    expect(rows[0].description).toBe('a value');
  });

  it('빈 frontmatter (CRLF) — frontmatter_json=null, description은 body 폴백', () => {
    writeFile('.claude/agents/empty.md', '---\r\n---\r\nbody only\r\n');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows[0].name).toBe('empty'); // 파일명 폴백
    expect(rows[0].frontmatter_json).toBeNull();
    expect(rows[0].description).toBe('body only');
  });

  it('따옴표 값 — 양끝 따옴표 제거(stripQuotes)', () => {
    writeFile('.claude/agents/quoted.md', '---\nname: "quoted name"\ndescription: \'single quoted\'\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    expect(rows[0].name).toBe('quoted name');
    expect(rows[0].description).toBe('single quoted');
  });

  it('인라인 배열 [a, b, c] — 배열로 파싱되어 frontmatter_json에 보존', () => {
    writeFile('.claude/agents/arr.md', '---\nname: arr\ntools: [Read, Write, "Edit"]\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    const fm = JSON.parse(rows[0].frontmatter_json!);
    // 현재 동작 고정: 각 요소 trim + stripQuotes
    expect(fm.tools).toEqual(['Read', 'Write', 'Edit']);
  });

  it('빈 인라인 배열 [] → 빈 배열', () => {
    writeFile('.claude/agents/emptyarr.md', '---\nname: ea\ntools: []\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    const fm = JSON.parse(rows[0].frontmatter_json!);
    expect(fm.tools).toEqual([]);
  });

  it('bool / null / 숫자 — 타입 변환', () => {
    writeFile('.claude/agents/types.md', [
      '---',
      'name: types',
      'enabled: true',
      'disabled: false',
      'empty:',
      'nullish: null',
      'tilde: ~',
      'count: 42',
      'neg: -7',
      '---',
      'body',
    ].join('\n'));
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    const fm = JSON.parse(rows[0].frontmatter_json!);
    expect(fm.enabled).toBe(true);
    expect(fm.disabled).toBe(false);
    // 현재 동작 고정: 빈 값/null/~ 모두 null
    expect(fm.empty).toBeNull();
    expect(fm.nullish).toBeNull();
    expect(fm.tilde).toBeNull();
    expect(fm.count).toBe(42);
    expect(fm.neg).toBe(-7);
  });

  it("user-invocable: true (문자열 'true' 또는 bool true) → user_invocable", () => {
    writeFile('.claude/agents/inv.md', '---\nname: inv\nuser-invocable: true\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // 현재 동작 고정: frontmatter['user-invocable'] === true → user_invocable (scanner.ts:156-158)
    expect(rows[0].user_invocable).toBe(true);
  });

  it('닫는 --- 없는 frontmatter → frontmatter 무시, 전체를 body로', () => {
    writeFile('.claude/agents/unterminated.md', '---\nname: should_be_ignored\nno closing fence here');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // 현재 동작 고정: end<0 → frontmatter={}, name은 파일명 폴백 (scanner.ts:185-186)
    expect(rows[0].name).toBe('unterminated');
    expect(rows[0].frontmatter_json).toBeNull();
  });

  it('frontmatter 파싱 안 되는 라인(key: value 형식 아님)은 무시', () => {
    writeFile('.claude/agents/messy.md', '---\nname: messy\nthis line has no colon key\n- a yaml list item\n---\nbody');
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    const fm = JSON.parse(rows[0].frontmatter_json!);
    // 현재 동작 고정: 정규식 미매치 라인 skip → name만 보존
    expect(Object.keys(fm)).toEqual(['name']);
    expect(rows[0].name).toBe('messy');
  });

  it('description 200자 초과 — 헤딩 텍스트가 200자로 잘림', () => {
    const longHeading = '# ' + 'x'.repeat(300);
    writeFile('.claude/agents/longh.md', `---\nname: lh\n---\n${longHeading}\n`);
    const rows = scanRoot(ROOT, 'projectSettings', ROOT);
    // 현재 동작 고정: extractFirstHeading slice(0,200)
    expect(rows[0].description).toBe('x'.repeat(200));
  });
});

// =============================================================================
// scanGlobalUserDir — homedir 기반 ~/.claude 스캔
// =============================================================================

describe('scanGlobalUserDir', () => {
  it('~/.claude 없음 → 빈 배열', () => {
    FAKE_HOME = ROOT; // ROOT/.claude 없음
    expect(scanGlobalUserDir()).toEqual([]);
  });

  it('~/.claude 존재 → source=userSettings, source_root=~/.claude 절대경로', () => {
    FAKE_HOME = ROOT;
    writeFile('.claude/agents/ua.md', '---\nname: ua\ndescription: user agent\n---\nbody');
    const rows = scanGlobalUserDir();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('userSettings');
    // 현재 동작 고정: source_root는 ~/.claude 자체(scanner.ts:86)
    expect(rows[0].source_root).toBe(path.join(ROOT, '.claude'));
    expect(rows[0].name).toBe('ua');
  });
});
