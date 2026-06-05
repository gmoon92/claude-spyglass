// components/LangSwitcher.tsx — 언어 스위처 (classic lang-switcher.js + index.html island 대체)
//
// 배경: 과거 #lang-switcher 는 index.html 의 정적 classic i18n island 였고, lang-switcher.js 가
//   getElementById 로 바인딩(change→I18n.setLang)했다. LangSwitcherSlot 이 그 노드를 DOM 이동으로
//   차트 헤더에 노출했다. 본 컴포넌트가 이 3중 결선(island + lang-switcher.js + slot)을 React 단일
//   진입점으로 대체한다.
//
// i18n 동기 계약(중요):
//   - react-i18next: onChange 에서 i18n.changeLanguage(lang) → useTranslation 구독 컴포넌트 재렌더.
//   - 레거시 전역: 같은 onChange 에서 window.I18n?.setLang?.(lang) 도 호출해야 한다. 런타임 date-locale
//     폴백(i18n-utils getLocale 이 window.I18n.getLang 을 읽음)이 어긋나지 않도록 두 출처를 동기화한다.
//     (setLang → I18n.onChange → i18n-legacy-bridge 가 changeLanguage 로 재전파하지만, 그 경로가 없거나
//      stub 인 환경에서도 react 측은 직접 changeLanguage 로 즉시 반영되므로 양쪽 모두 호출한다.)
//
// 마크업/시각 계약: 기존 index.html island(.lang-switcher-wrap > select#lang-switcher[aria-label,role])
//   를 1:1 보존해 assets/css 의 lang-switcher 스타일이 그대로 먹는다(시각 회귀 0).

import { useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGS } from '../lib/i18n';

/** 지원 언어 → 네이티브 표기 라벨. 기존 index.html <option> 텍스트 1:1 보존. */
const LANG_LABELS: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
};

/**
 * 언어 스위처 select. 현재 언어(i18n.language)를 value 로, change 시 react-i18next changeLanguage 와
 * 레거시 window.I18n.setLang 을 함께 호출해 두 i18n 출처를 동기화한다.
 */
export function LangSwitcher(): ReactElement {
  const { t, i18n } = useTranslation();

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const lang = e.target.value;
      if (!(SUPPORTED_LANGS as readonly string[]).includes(lang)) return;
      // react-i18next(SSoT for 구독 컴포넌트) — 즉시 반응형 전환.
      void i18n.changeLanguage(lang);
      // 레거시 전역 동기 — date-locale 폴백(i18n-utils getLocale)이 window.I18n.getLang 을 읽으므로 필수.
      void (globalThis as { window?: { I18n?: { setLang?: (l: string) => Promise<void> | void } } }).window?.I18n?.setLang?.(
        lang,
      );
    },
    [i18n],
  );

  return (
    <div className="lang-switcher-wrap">
      <select
        id="lang-switcher"
        aria-label={t('ui.html.chart-section.lang-switcher-aria')}
        role="combobox"
        value={i18n.language}
        onChange={onChange}
      >
        {SUPPORTED_LANGS.map((lang) => (
          <option key={lang} value={lang}>
            {LANG_LABELS[lang] ?? lang}
          </option>
        ))}
      </select>
    </div>
  );
}
