/**
 * spyglass TUI entry point.
 *
 * Renders the App with Capabilities provider; exits cleanly on user quit.
 */

import { render } from 'ink';
import { App } from './App';

const { waitUntilExit } = render(<App />);

waitUntilExit().then(
  () => process.exit(0),
  () => process.exit(1),
);
