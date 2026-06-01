// components/LangSwitcherSlot.tsx — classic lang-switcher island 을 차트 헤더 슬롯에 편입 (레거시 복원)
//
// 원본: spyglass-legacy-ref index.html(:413~424) 의 .chart-actions 안 .lang-switcher-wrap > select#lang-switcher.
//   React 셸은 #lang-switcher 를 직접 렌더할 수 없다 — index.html 에 정적 classic i18n island
//   (.lang-switcher-wrap[data-classic-i18n-island="lang-switcher"] > select#lang-switcher) 이 이미 존재하고
//   lang-switcher.js 가 그 노드를 getElementById 로 바인딩(I18n.setLang→reload)하기 때문이다. React 가
//   동일 id 를 한 번 더 렌더하면 id 중복 + 바인딩 깨짐.
//
// 해법(중복 id 회피 + 시각 배치 복원): React 는 빈 슬롯 div 만 렌더하고, 마운트 시 기존 island 노드를
//   DOM 이동(appendChild)으로 이 슬롯에 옮긴다. 노드 자체는 동일 인스턴스라 lang-switcher.js 바인딩이
//   그대로 유지되고(이벤트 리스너는 노드 이동에 보존됨), 차트 헤더에 시각적으로 노출된다. 언마운트 시
//   island 를 body 로 되돌려(원위치) 재마운트/HMR 에서도 안전.
//
// 레이어: components leaf. window/document 안전 접근(SSR·스텁 무발화).

import { useEffect, useRef, type ReactElement } from 'react';

/** index.html 정적 island 셀렉터 — DOM 이동 대상. */
const ISLAND_SELECTOR = '.lang-switcher-wrap[data-classic-i18n-island="lang-switcher"]';

/**
 * 차트 헤더 lang-switcher 슬롯. 마운트 시 classic island 노드를 슬롯으로 이동, 언마운트 시 body 로 복원.
 * island 가 없으면(테스트/SSR) no-op — 슬롯만 비어 렌더된다.
 */
export function LangSwitcherSlot(): ReactElement {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    const slot = slotRef.current;
    if (!doc || !slot) return undefined;
    const island = doc.querySelector(ISLAND_SELECTOR);
    if (!island) return undefined;
    // 직전 부모 기억 — 언마운트 시 원위치 복원(통상 body).
    const prevParent = island.parentElement;
    slot.appendChild(island);
    return () => {
      // 슬롯이 사라지기 전 island 를 원래 부모로 되돌려 다음 마운트에서 다시 찾을 수 있게 한다.
      if (prevParent && island.parentElement === slot) prevParent.appendChild(island);
    };
  }, []);

  return <div className="lang-switcher-slot" ref={slotRef} data-testid="lang-switcher-slot" />;
}
