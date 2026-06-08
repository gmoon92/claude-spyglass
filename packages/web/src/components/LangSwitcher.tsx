// components/LangSwitcher.tsx — 언어 스위처 (classic lang-switcher.js + index.html island 대체)
//
// 배경: 과거 #lang-switcher 는 index.html 의 정적 classic i18n island 였고, lang-switcher.js 가
//   getElementById 로 바인딩(change→I18n.setLang)했다. LangSwitcherSlot 이 그 노드를 DOM 이동으로
//   차트 헤더에 노출했다. 본 컴포넌트가 이 3중 결선(island + lang-switcher.js + slot)을 React 단일
//   진입점으로 대체한다.
//
// i18n 동기 계약:
//   - react-i18next 단일 SSoT: onChange 에서 i18n.changeLanguage(lang) 만 호출한다 →
//     useTranslation 구독 컴포넌트 재렌더 + i18n-utils getLocale(i18next.language) 즉시 정합 +
//     i18n.ts 의 languageChanged 리스너가 localStorage 영속까지 담당한다(레거시 window.I18n.setLang 폐기).
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
 * 언어 스위처 select. 현재 언어(i18n.language)를 value 로, change 시 react-i18next changeLanguage 를
 * 호출한다(단일 SSoT). 영속(localStorage)은 i18n.ts 의 languageChanged 리스너가 담당한다.
 */
export function LangSwitcher(): ReactElement {
  const { t, i18n } = useTranslation();

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const lang = e.target.value;
      if (!(SUPPORTED_LANGS as readonly string[]).includes(lang)) return;
      // react-i18next 단일 SSoT — 즉시 반응형 전환 + getLocale(i18next.language) 정합 + localStorage 영속.
      void i18n.changeLanguage(lang);
    },
    [i18n],
  );

  return (
    <div className="lang-switcher-wrap">
      <select
        id="lang-switcher"
        aria-label={t('ui:html.chart-section.lang-switcher-aria')}
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
