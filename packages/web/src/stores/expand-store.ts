// stores/expand-store.ts — 펼쳐진 요청 행(prompt-expand) 레지스트리 (keyboard-shortcuts DOM 우회 제거)
//
// 배경:
//   프롬프트/메시지 펼침 상태는 RequestRow 의 행 단위 로컬 useState(expanded) 가 SSoT 다(피드·turn 양쪽 공용).
//   레거시 ESC 핸들러는 펼친 행을 닫으려고 document.querySelector('[data-expand-for]') 로 DOM 을 직접 잡아
//   직전 행의 토글을 .click() 했다 — DOM 클릭 시뮬레이션 우회.
//
// 정공법 전환:
//   - 펼쳐진 RequestRow 가 자신의 collapse 콜백을 이 레지스트리에 등록(register)/해제(unregister)한다.
//   - use-keyboard-shortcuts 는 DOM 조회 대신 collapseTopExpanded() 액션을 호출 — 가장 최근 펼친 행의
//     collapse 콜백을 실행하고, 닫을 행이 있었는지 boolean 으로 알려준다(ESC 우선순위 분기 판단용).
//   - RequestRow 의 공개 시그니처(props)는 불변 — 컴포넌트가 내부에서 이 store 를 구독·등록만 한다.
//
// "한 행만 닫는다"는 레거시 ESC 의미(querySelector 단일 매칭 + return)를 보존한다. 다중 펼침 시 LIFO
//   (가장 최근 펼친 행)를 닫는 것이 자연스러운 UX 이며, 실사용은 보통 1개만 펼쳐져 있다.
//
// React 트리 밖 명령형 호출(키보드 핸들러)에서 쓰이므로 Zustand getState/subscribe 패턴이 적합하다.

import { create } from 'zustand';

interface ExpandRegistryState {
  /** rid → collapse 콜백. 등록 순서(삽입 순서)를 Map 이 보존하므로 LIFO 선택 가능. */
  readonly collapsers: Map<string, () => void>;
  /** 펼쳐진 행이 자신의 collapse 콜백을 등록(마운트/펼침 시). 이미 있으면 콜백 갱신. */
  register: (rid: string, collapse: () => void) => void;
  /** 등록 해제(닫힘/언마운트 시). */
  unregister: (rid: string) => void;
  /**
   * 가장 최근 펼친 행 하나를 닫는다(레거시 ESC 의 "펼침 행이 있으면 하나 닫고 멈춤" 1:1).
   * @returns 닫을 행이 있어 실제로 닫았으면 true, 없으면 false(ESC 다음 우선순위로 진행).
   */
  collapseTopExpanded: () => boolean;
}

export const useExpandStore = create<ExpandRegistryState>((set, get) => ({
  collapsers: new Map<string, () => void>(),
  register: (rid, collapse) => {
    // 동일 Map 인스턴스를 변형하되 새 참조로 set — 셀렉터 구독자가 있어도 안전(현재 구독자 없음, getState 만 사용).
    const next = new Map(get().collapsers);
    next.set(rid, collapse);
    set({ collapsers: next });
  },
  unregister: (rid) => {
    const cur = get().collapsers;
    if (!cur.has(rid)) return;
    const next = new Map(cur);
    next.delete(rid);
    set({ collapsers: next });
  },
  collapseTopExpanded: () => {
    const cur = get().collapsers;
    if (cur.size === 0) return false;
    // 가장 최근 등록(삽입 순서 마지막) = LIFO. Map 삽입 순서 보존을 활용.
    let lastRid: string | null = null;
    for (const rid of cur.keys()) lastRid = rid;
    if (lastRid === null) return false;
    const collapse = cur.get(lastRid);
    // 등록 해제는 RequestRow 의 unregister(언마운트/닫힘 effect)가 담당 — 여기선 collapse 만 호출.
    collapse?.();
    return true;
  },
}));
