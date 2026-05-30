/**
 * i18n-dom.js — data-i18n 속성 기반 DOM 자동 번역 헬퍼
 *
 * 의존: window.I18n (i18n.js 보다 나중에 로드)
 *
 * 지원 속성:
 *   data-i18n="ui.key"                    → 요소의 textContent 갱신
 *   data-i18n-attr-aria-label="ui.key"    → aria-label 속성 갱신
 *   data-i18n-attr-title="ui.key"         → title 속성 갱신
 *   data-i18n-attr-placeholder="ui.key"   → placeholder 속성 갱신
 *
 * 규칙:
 *   - 번역 값이 없거나 키가 잘못된 경우 원본(fallback) 값 그대로 유지
 *   - I18n.onChange 등록으로 언어 변경 시 자동 재갱신
 */
(function () {
  'use strict';

  /**
   * data-i18n 속성을 가진 모든 요소의 텍스트/속성을 갱신.
   */
  function applyAll() {
    const i18n = window.I18n;
    if (!i18n) return;

    // textContent 갱신
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const translated = i18n.t(key);
      // 키 자체가 반환되면(번역 없음) 원본 유지
      if (translated && translated !== key) {
        el.textContent = translated;
      }
    });

    // data-i18n-attr-* 패턴: 요소별로 dataset을 순회
    document.querySelectorAll('*').forEach(function (el) {
      const dataset = /** @type {HTMLElement} */ (el).dataset;
      Object.keys(dataset).forEach(function (dataKey) {
        // dataKey 예: 'i18nAttrAriaLabel' (camelCase from data-i18n-attr-aria-label)
        if (!dataKey.startsWith('i18nAttr')) return;
        // camelCase → kebab-case 변환 후 'i18n-attr-' prefix 제거
        // 'i18nAttrAriaLabel' → attr name = 'aria-label'
        const suffix = dataKey.slice('i18nAttr'.length); // 'AriaLabel'
        // camelCase suffix → kebab-case attr name
        const attrName = suffix
          .replace(/([A-Z])/g, function (m) { return '-' + m.toLowerCase(); })
          .replace(/^-/, ''); // 'aria-label'

        const key = dataset[dataKey];
        if (!key) return;
        const translated = i18n.t(key);
        if (translated && translated !== key) {
          el.setAttribute(attrName, translated);
        }
      });
    });
  }

  /**
   * I18n 초기화 완료를 기다린 뒤 첫 적용 + onChange 등록.
   * i18n.js의 DOMContentLoaded 핸들러가 I18n.init()을 비동기로 호출하므로,
   * 여기서는 I18n.init()의 Promise를 직접 await해 확실히 fetch 완료 후 적용.
   */
  function init() {
    const i18n = window.I18n;
    if (!i18n) {
      console.warn('[i18n-dom] window.I18n is missing — i18n.js must be loaded first.');
      return;
    }

    // 언어 변경 시 재갱신
    i18n.onChange(function () {
      applyAll();
    });

    // I18n.init()이 반환하는 Promise를 직접 await해 fetch 완료 후 적용.
    // i18n.js는 DOMContentLoaded 에서 I18n.init()을 호출하며 동일 이벤트로
    // i18n-dom.js의 init()도 실행되므로, I18n.init()을 다시 호출해도
    // 내부 캐시가 이미 채워져 있으면 fetch를 재실행하지 않는다.
    i18n.init().then(function () {
      applyAll();
    }).catch(function (err) {
      console.error('[i18n-dom] I18n.init failed', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
