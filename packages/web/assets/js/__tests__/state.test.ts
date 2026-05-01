import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getRightView, setRightView,
  getDetailTab, setDetailTab,
  getSelectedProject, setSelectedProject,
  getSelectedSession, setSelectedSession,
} from '../state.js';

// state.js는 모듈 수준 변수를 공유하므로 각 테스트 전 초기값 복원
beforeEach(() => {
  setRightView('default');
  setDetailTab('requests');
  setSelectedProject(null);
  setSelectedSession(null);
});

describe('rightView', () => {
  it('초기값은 "default"', () => {
    expect(getRightView()).toBe('default');
  });

  it('setRightView → getRightView 반환', () => {
    setRightView('detail');
    expect(getRightView()).toBe('detail');
  });

  it('다시 "default"로 복구', () => {
    setRightView('detail');
    setRightView('default');
    expect(getRightView()).toBe('default');
  });
});

describe('detailTab', () => {
  it('초기값은 "requests"', () => {
    expect(getDetailTab()).toBe('requests');
  });

  it('setDetailTab → getDetailTab 반환', () => {
    setDetailTab('turn');
    expect(getDetailTab()).toBe('turn');
  });

  it('임의 문자열도 저장', () => {
    setDetailTab('timeline');
    expect(getDetailTab()).toBe('timeline');
  });
});

describe('selectedProject', () => {
  it('초기값은 null', () => {
    expect(getSelectedProject()).toBeNull();
  });

  it('setSelectedProject → getSelectedProject 반환', () => {
    setSelectedProject('my-project');
    expect(getSelectedProject()).toBe('my-project');
  });

  it('null로 초기화 가능', () => {
    setSelectedProject('proj');
    setSelectedProject(null);
    expect(getSelectedProject()).toBeNull();
  });
});

describe('selectedSession', () => {
  it('초기값은 null', () => {
    expect(getSelectedSession()).toBeNull();
  });

  it('setSelectedSession → getSelectedSession 반환', () => {
    setSelectedSession('sess-abc');
    expect(getSelectedSession()).toBe('sess-abc');
  });

  it('null로 초기화 가능', () => {
    setSelectedSession('sess-xyz');
    setSelectedSession(null);
    expect(getSelectedSession()).toBeNull();
  });
});

describe('독립성: 한 상태 변경이 다른 상태에 영향 없음', () => {
  it('rightView 변경 시 detailTab 유지', () => {
    setDetailTab('turn');
    setRightView('detail');
    expect(getDetailTab()).toBe('turn');
  });

  it('selectedProject 변경 시 selectedSession 유지', () => {
    setSelectedSession('s1');
    setSelectedProject('proj-a');
    expect(getSelectedSession()).toBe('s1');
  });
});
