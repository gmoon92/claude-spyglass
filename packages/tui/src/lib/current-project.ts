/**
 * current-project — derive the project name TUI should focus on.
 *
 * Order: SPYGLASS_PROJECT env var → basename(process.cwd()).
 * Set SPYGLASS_ALL_PROJECTS=1 to disable filtering.
 */

import { basename } from 'node:path';

export type CurrentProject = {
  name: string | null;
  showAll: boolean;
};

export function getCurrentProject(): CurrentProject {
  const showAll = process.env.SPYGLASS_ALL_PROJECTS === '1';
  if (showAll) return { name: null, showAll: true };

  const explicit = process.env.SPYGLASS_PROJECT?.trim();
  if (explicit) return { name: explicit, showAll: false };

  const cwd = process.cwd();
  const name = basename(cwd);
  return { name: name || null, showAll: false };
}
