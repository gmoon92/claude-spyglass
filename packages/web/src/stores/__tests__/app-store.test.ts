import { describe, it, expect, beforeEach } from 'bun:test';
import { useAppStore } from '../app-store';

// state.test.ts 14 case 1:1 동치 계승 (P1-04).
// 원본(assets/js/__tests__/state.test.ts:9-15) beforeEach 패턴을 그대로 계승:
//   상태 SSoT가 모듈 변수(state.js) → Zustand 스토어로 바뀌었을 뿐, 각 테스트 전 초기값 강제 복원.
//   getX()/setX(v) 호출은 useAppStore.getState().x / .setX(v) 로만 치환(케이스 추가/삭제 금지).
//
// ⚠️ 초기값 주의(panel tdd.md §2-1): 스토어 진짜 초기값은 state.js:14-26 SSoT(detailTab='log')이나,
//   원본 테스트가 beforeEach 에서 setDetailTab('requests') 로 강제하므로 동일 패턴을 그대로 계승한다.
//   따라서 "초기값" 케이스는 source default 가 아니라 beforeEach 로 세팅한 값을 검증한다(원본과 동일).
beforeEach(() => {
  const s = useAppStore.getState();
  s.setRightView('default');
  s.setDetailTab('requests');
  s.setSelectedProject(null);
  s.setSelectedSession(null);
});

describe('rightView', () => {
  it('초기값은 "default"', () => {
    expect(useAppStore.getState().rightView).toBe('default');
  });

  it('setRightView → getRightView 반환', () => {
    useAppStore.getState().setRightView('detail');
    expect(useAppStore.getState().rightView).toBe('detail');
  });

  it('다시 "default"로 복구', () => {
    useAppStore.getState().setRightView('detail');
    useAppStore.getState().setRightView('default');
    expect(useAppStore.getState().rightView).toBe('default');
  });
});

describe('detailTab', () => {
  it('초기값은 "requests"', () => {
    expect(useAppStore.getState().detailTab).toBe('requests');
  });

  it('setDetailTab → getDetailTab 반환', () => {
    useAppStore.getState().setDetailTab('turn');
    expect(useAppStore.getState().detailTab).toBe('turn');
  });

  it('임의 문자열도 저장', () => {
    useAppStore.getState().setDetailTab('timeline');
    expect(useAppStore.getState().detailTab).toBe('timeline');
  });
});

describe('selectedProject', () => {
  it('초기값은 null', () => {
    expect(useAppStore.getState().selectedProject).toBeNull();
  });

  it('setSelectedProject → getSelectedProject 반환', () => {
    useAppStore.getState().setSelectedProject('my-project');
    expect(useAppStore.getState().selectedProject).toBe('my-project');
  });

  it('null로 초기화 가능', () => {
    useAppStore.getState().setSelectedProject('proj');
    useAppStore.getState().setSelectedProject(null);
    expect(useAppStore.getState().selectedProject).toBeNull();
  });
});

describe('selectedSession', () => {
  it('초기값은 null', () => {
    expect(useAppStore.getState().selectedSession).toBeNull();
  });

  it('setSelectedSession → getSelectedSession 반환', () => {
    useAppStore.getState().setSelectedSession('sess-abc');
    expect(useAppStore.getState().selectedSession).toBe('sess-abc');
  });

  it('null로 초기화 가능', () => {
    useAppStore.getState().setSelectedSession('sess-xyz');
    useAppStore.getState().setSelectedSession(null);
    expect(useAppStore.getState().selectedSession).toBeNull();
  });
});

describe('독립성: 한 상태 변경이 다른 상태에 영향 없음', () => {
  it('rightView 변경 시 detailTab 유지', () => {
    useAppStore.getState().setDetailTab('turn');
    useAppStore.getState().setRightView('detail');
    expect(useAppStore.getState().detailTab).toBe('turn');
  });

  it('selectedProject 변경 시 selectedSession 유지', () => {
    useAppStore.getState().setSelectedSession('s1');
    useAppStore.getState().setSelectedProject('proj-a');
    expect(useAppStore.getState().selectedSession).toBe('s1');
  });
});
