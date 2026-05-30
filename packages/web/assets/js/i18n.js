/**
 * i18n.js — Claude Spyglass 자체 국제화 헬퍼 (번들러 없음, IIFE 전역 노출)
 *
 * 지원 언어: ko, en, ja, zh
 * 지원 namespace: common, request, badges, session, ui
 *
 * 언어 결정 우선순위:
 *   1. URL 쿼리 ?lang= (지원 언어일 때)
 *   2. localStorage['spyglass:lang']
 *   3. navigator.language primary subtag (ko-KR → ko)
 *   4. 기본값 'ko'
 *
 * t() 키 컨벤션:
 *   t('badges.hint.lines', {count: 5})
 *   → namespace='badges', path='hint.lines'
 *   첫 segment = namespace, 나머지 = dot path
 */
(function () {
  'use strict';

  const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh'];
  const NAMESPACES = ['common', 'request', 'badges', 'session', 'ui'];
  const LS_KEY = 'spyglass:lang';

  /** @type {string} */
  let currentLang = 'ko';

  /**
   * 메모리 캐시: cache[lang][ns] = { ...translations }
   * @type {Record<string, Record<string, Record<string, unknown>>>}
   */
  const cache = {};

  /** @type {Array<(lang: string) => void>} */
  const listeners = [];

  // ─── 내부 유틸 ────────────────────────────────────────────────

  /**
   * BCP-47 primary subtag → 지원 언어 코드 매핑.
   * @param {string} tag - e.g. 'ko-KR', 'zh-TW', 'en-US'
   * @returns {string|null}
   */
  function mapPrimaryTag(tag) {
    const primary = tag.split('-')[0].toLowerCase();
    if (SUPPORTED_LANGS.includes(primary)) return primary;
    return null;
  }

  /**
   * URL 쿼리, localStorage, navigator.language 순으로 언어 결정.
   * @returns {string}
   */
  function resolveLang() {
    // 1. URL ?lang=
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang && SUPPORTED_LANGS.includes(urlLang)) return urlLang;

    // 2. localStorage
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
    } catch (_) { /* 시크릿 모드 등 */ }

    // 3. navigator.language
    const navLangs = navigator.languages || [navigator.language];
    for (const tag of navLangs) {
      const mapped = mapPrimaryTag(tag);
      if (mapped) return mapped;
    }

    // 4. 기본값
    return 'ko';
  }

  /**
   * 단일 lang+ns JSON을 fetch. 실패 시 {} 폴백.
   * @param {string} lang
   * @param {string} ns
   * @returns {Promise<Record<string, unknown>>}
   */
  async function fetchNs(lang, ns) {
    // 캐시 히트
    if (cache[lang]?.[ns]) return cache[lang][ns];

    try {
      const res = await fetch(`/locales/${lang}/${ns}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache[lang] = cache[lang] || {};
      cache[lang][ns] = data;
      return data;
    } catch (err) {
      console.warn(`[i18n] locales/${lang}/${ns}.json load failed — falling back to empty object.`, err);
      cache[lang] = cache[lang] || {};
      cache[lang][ns] = {};
      return {};
    }
  }

  /**
   * 특정 lang의 모든 namespace를 병렬 로딩.
   * @param {string} lang
   * @returns {Promise<void>}
   */
  async function loadAllNs(lang) {
    await Promise.all(NAMESPACES.map((ns) => fetchNs(lang, ns)));
  }

  /**
   * 중첩 객체에서 dot-path로 값을 꺼냄.
   * @param {Record<string, unknown>} obj
   * @param {string[]} parts
   * @returns {unknown}
   */
  function getByPath(obj, parts) {
    let cur = /** @type {unknown} */ (obj);
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = /** @type {Record<string, unknown>} */ (cur)[part];
    }
    return cur;
  }

  /**
   * <html lang="..."> 속성을 활성 언어로 동기화.
   * 접근성(스크린리더 발음·문법검사기)·SEO·CSS :lang() 선택자에 영향.
   * @param {string} lang
   */
  function syncDocumentLang(lang) {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = lang;
    }
  }

  /**
   * {var} 인터폴레이션.
   * @param {string} str
   * @param {Record<string, string|number>} [vars]
   * @returns {string}
   */
  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (_, key) => {
      const val = vars[key];
      return val != null ? String(val) : `{${key}}`;
    });
  }

  // ─── 공개 API ─────────────────────────────────────────────────

  const I18n = {
    /**
     * 초기화. 언어 결정 → 모든 namespace 비동기 로딩.
     * @param {object} [opts]
     * @param {string} [opts.lang] - 강제 언어 지정 (지원 언어일 때만 유효)
     * @returns {Promise<void>}
     */
    async init(opts = {}) {
      const forced = opts.lang && SUPPORTED_LANGS.includes(opts.lang) ? opts.lang : null;
      currentLang = forced || resolveLang();
      await loadAllNs(currentLang);
      syncDocumentLang(currentLang);
    },

    /**
     * 번역 조회. Spring properties 스타일 — 키는 dot 구분 식별자.
     * 권장 호출 패턴: `<ns>.<path>` — 첫 segment가 namespace (예: 'ui.cache-panel.hit-rate.desc')
     *
     * 호환을 위해 ns prefix 없는 호출도 지원하지만 dev 환경에서 경고 출력.
     * 모든 호출은 명시적 ns prefix를 사용하는 게 SSoT 안전.
     *
     * 키를 찾지 못하면 key 자체를 반환.
     * @param {string} key
     * @param {Record<string, string|number>} [vars]
     * @returns {string}
     */
    t(key, vars) {
      const segments = key.split('.');
      if (segments.length < 1) return key;

      const langCache = cache[currentLang] || {};
      // dev 환경 한정 runtime 안전망 — localhost/127.* hostname 휴리스틱.
      const warnMissing = (typeof window !== 'undefined' &&
        /(^|\.)localhost$|^127\./.test(window.location?.hostname || ''));

      // 시도 1: 첫 segment가 namespace이면 그 ns에서 path 탐색 (권장 패턴)
      if (segments.length >= 2 && NAMESPACES.includes(segments[0])) {
        const nsData = langCache[segments[0]];
        if (nsData) {
          const v = getByPath(nsData, segments.slice(1));
          if (typeof v === 'string') return interpolate(v, vars);
        }
      }

      // 시도 2: 모든 namespace에서 전체 path 탐색 (ns prefix 없는 호출 — fragile)
      // dev 환경에서는 fallback 경로 사용 시 console.warn으로 회귀 위험을 노출.
      // 미래에 다른 ns에 동일 path가 추가되면 어느 ns가 hit될지 예측 불가하므로
      // 모든 호출은 'ns.path' 형태가 권장됨.
      for (const ns of NAMESPACES) {
        const nsData = langCache[ns];
        if (!nsData) continue;
        const v = getByPath(nsData, segments);
        if (typeof v === 'string') {
          if (warnMissing && !NAMESPACES.includes(segments[0])) {
            console.warn(`[i18n] ns-less key "${key}" resolved via fallback to "${ns}.${key}" — 명시적 ns prefix 권장 (fragility 회피).`);
          }
          return interpolate(v, vars);
        }
      }

      // 못 찾음 → key 반환 (단일 경로로 폴백 처리 위해 아래 기존 흐름 유지)
      const [ns, ...rest] = segments;
      const nsData = langCache[ns];
      if (!nsData) {
        if (warnMissing) console.warn(`[i18n] missing key "${key}" (lng=${currentLang})`);
        return key;
      }
      const val = getByPath(nsData, rest);
      if (typeof val !== 'string') {
        if (warnMissing) console.warn(`[i18n] missing key "${key}" (lng=${currentLang})`);
        return key;
      }

      return interpolate(val, vars);
    },

    /**
     * 언어 변경 — localStorage 저장 후 onChange 리스너 호출 및 페이지 리로드.
     * @param {string} lang
     */
    async setLang(lang) {
      if (!SUPPORTED_LANGS.includes(lang)) {
        console.warn(`[i18n] unsupported language: ${lang}`);
        return;
      }
      try {
        localStorage.setItem(LS_KEY, lang);
      } catch (_) { /* 시크릿 모드 */ }

      currentLang = lang;
      await loadAllNs(lang);
      syncDocumentLang(lang);

      // onChange 리스너 호출
      for (const fn of listeners) {
        try { fn(lang); } catch (e) { console.error('[i18n] onChange listener error', e); }
      }
    },

    /**
     * 현재 언어 반환.
     * @returns {string}
     */
    getLang() {
      return currentLang;
    },

    /**
     * 지원 언어 목록 반환.
     * @returns {string[]}
     */
    getSupportedLangs() {
      return [...SUPPORTED_LANGS];
    },

    /**
     * 언어 변경 리스너 등록.
     * @param {(lang: string) => void} fn
     * @returns {() => void} unsubscribe 함수
     */
    onChange(fn) {
      listeners.push(fn);
      return function unsubscribe() {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
  };

  // 전역 노출
  window.I18n = I18n;

  // 페이지 로드 시 자동 초기화
  document.addEventListener('DOMContentLoaded', function () {
    I18n.init().catch(function (err) {
      console.error('[i18n] init failed', err);
    });
  });
})();
