/**
 * spyglass TUI entry point.
 *
 * Renders the App with Capabilities provider; exits cleanly on user quit.
 */

import { render } from 'ink';
import { initI18n } from './i18n';
import { detectLang } from './lib/detect-lang';
import { App } from './app';

await initI18n(detectLang());

const { waitUntilExit } = render(<App />);

waitUntilExit().then(
  () => process.exit(0),
  () => process.exit(1),
);
