/**
 * sessions.render.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 렌더 출력이 스펙).
 *
 * Sessions 화면은 순수 props 기반(sessions/projectName/selectedIndex/showAll)이라
 * fetch/context 주입 없이 ink-testing-library render + lastFrame 으로 검증한다.
 *
 * 커버:
 *   - 0 sessions → empty state 문구 ("No active sessions")
 *   - 0 sessions + showAll → 다른 안내 문구
 *   - N sessions → 각 행 + 선택 marker(▶) 1개만
 *   - 타이틀에 active count + projectName
 *   - showAll + project_name → 프로젝트 라벨 노출
 */

import { describe, it, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { Sessions } from '../screens/Sessions';
import { makeSession } from './helpers/fixtures';

/** ANSI escape 제거. */
function strip(frame: string): string {
  // eslint-disable-next-line no-control-regex
  return frame.replace(/\x1B\[[0-9;]*m/g, '');
}

function renderSessions(props: Parameters<typeof Sessions>[0]): string {
  const { lastFrame, unmount } = render(<Sessions {...props} />);
  const out = strip(lastFrame() ?? '');
  unmount();
  return out;
}

describe('Sessions — 빈 목록', () => {
  it('0 sessions → "No active sessions" empty state', () => {
    const out = renderSessions({ sessions: [], projectName: null, selectedIndex: 0 });
    expect(out).toContain('No active sessions');
    // 타이틀 active count 0
    expect(out).toContain('0 active');
  });

  it('projectName 이 있으면 empty 문구에 프로젝트명 포함', () => {
    const out = renderSessions({ sessions: [], projectName: 'demo', selectedIndex: 0 });
    expect(out).toContain('No active sessions for demo');
    expect(out).toContain('demo');
  });

  it('showAll=true → SPYGLASS_ALL_PROJECTS 안내 대신 "Once Claude runs" 문구', () => {
    const out = renderSessions({ sessions: [], projectName: null, selectedIndex: 0, showAll: true });
    expect(out).toContain('Once Claude runs');
  });

  it('showAll=false → SPYGLASS_ALL_PROJECTS 안내 문구', () => {
    const out = renderSessions({ sessions: [], projectName: null, selectedIndex: 0, showAll: false });
    expect(out).toContain('SPYGLASS_ALL_PROJECTS');
  });
});

describe('Sessions — N sessions', () => {
  const sessions = [
    makeSession({ id: 'aaaa1111bbbb', total_tokens: 1000, current_turn: 1 }),
    makeSession({ id: 'cccc2222dddd', total_tokens: 2000, current_turn: 2 }),
    makeSession({ id: 'eeee3333ffff', total_tokens: 3000, current_turn: 3 }),
  ];

  it('각 세션 행이 S- prefix 로 렌더된다', () => {
    const out = renderSessions({ sessions, projectName: null, selectedIndex: 0 });
    expect(out).toContain('S-aaaa1111');
    expect(out).toContain('S-cccc2222');
    expect(out).toContain('S-eeee3333');
    expect(out).toContain('3 active');
  });

  it('선택 marker(▶) 는 정확히 1개만 등장한다', () => {
    const out = renderSessions({ sessions, projectName: null, selectedIndex: 1 });
    const markerCount = (out.match(/▶/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('selectedIndex 가 범위를 벗어나면 marker 가 등장하지 않는다 (클램핑 없음 — 현재 동작 고정)', () => {
    // 현재 Sessions 는 selectedIndex 를 클램핑하지 않고 i===selectedIndex 비교만 한다.
    // 범위 밖(99) 이면 어떤 행도 selected 가 아니므로 marker 0개.
    const out = renderSessions({ sessions, projectName: null, selectedIndex: 99 });
    const markerCount = (out.match(/▶/g) ?? []).length;
    expect(markerCount).toBe(0);
  });

  it('showAll + project_name → [프로젝트명] 라벨 노출', () => {
    const withProject = [makeSession({ id: 'aaaa1111bbbb', project_name: 'my-proj' } as never)];
    const out = renderSessions({ sessions: withProject, projectName: null, selectedIndex: 0, showAll: true });
    expect(out).toContain('my-proj');
  });
});
