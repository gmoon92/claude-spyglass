/**
 * spyglass TUI Entry Point
 *
 * @description Ink 기반 터미널 UI
 * @see docs/planning/02-prd.md - UI/UX 설계
 */

/** @jsxImportSource react */
import React from 'react';
import { render } from 'ink';
import { App } from './app';

// 앱 렌더링
const { waitUntilExit } = render(<App />);

// 정상 종료 처리
waitUntilExit().then(() => {
  process.exit(0);
});
