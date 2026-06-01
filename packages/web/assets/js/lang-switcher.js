/**
 * lang-switcher.js — 언어 스위처 드롭다운 핸들러
 *
 * window.I18n (i18n.js) 전역 객체에 의존.
 * i18n.js가 먼저 로드되어 window.I18n이 존재한다고 가정.
 *
 * 동작:
 *   - DOM ready 시 현재 언어를 select 요소에 반영
 *   - change 이벤트에서 I18n.setLang() 호출
 *   - I18n.onChange 리스너로 외부 변경도 동기화
 */
(function () {
  'use strict';

  /**
   * select#lang-switcher 요소를 현재 언어로 동기화.
   * @param {HTMLSelectElement} el
   * @param {string} lang
   */
  function syncSelect(el, lang) {
    if (el.value !== lang) {
      el.value = lang;
    }
  }

  /**
   * lang-switcher를 초기화.
   * I18n이 준비되지 않았으면 DOMContentLoaded 이후 재시도.
   */
  function init() {
    const el = /** @type {HTMLSelectElement|null} */ (document.getElementById('lang-switcher'));
    if (!el) return;

    const i18n = window.I18n;
    if (!i18n) {
      // 개발자용 경고 — 다국어 환경에서 한국어 raw 노출 회피 목적으로 영어로 통일.
      console.warn('[lang-switcher] window.I18n is missing — i18n.js must be loaded first.');
      return;
    }

    // 현재 언어 반영
    syncSelect(el, i18n.getLang());

    // 사용자가 드롭다운 변경 시 언어 전환
    //   (태스크 #12) 과거 setLang 후 window.location.reload() 로 SPA 를 통째로 새로고침했다. 이제
    //   React 측이 react-i18next 로 반응형 전환한다: setLang → I18n.onChange 리스너(main.tsx 브릿지)가
    //   i18next.changeLanguage 를 호출 → useTranslation 구독 컴포넌트가 reload 없이 재렌더된다.
    //   따라서 하드 리로드를 제거한다(SPA 상태 보존).
    el.addEventListener('change', function () {
      const selected = el.value;
      if (selected && i18n.getSupportedLangs().includes(selected)) {
        i18n.setLang(selected).catch(function (err) {
          console.error('[lang-switcher] setLang failed:', err);
        });
      }
    });

    // 외부(다른 모듈 등)에서 언어가 바뀌면 select를 동기화
    i18n.onChange(function (lang) {
      syncSelect(el, lang);
    });
  }

  // DOMContentLoaded 이후 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
