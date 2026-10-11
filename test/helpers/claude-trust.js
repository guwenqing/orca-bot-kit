// What a live test checks before it answers Claude Code's folder trust in a
// throwaway tab of its own (#558): helpers/screens.js `claudeTrustOf`, given
// the allow list in the tab's own folder and the kit's default rules for the
// test's throwaway bots folder.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { defaultRules } from '../../src/permissions.js';
import { claudeTrustOf } from './screens.js';

/**
 * The allow list in the bot folder `home`'s own `.claude/settings.json`:
 * `permissions.allow`, or [] when the file has none. A file that cannot be
 * read or parsed throws, and so fails the run.
 */
export function claudeAllowIn(home) {
  const file = path.join(home, '.claude', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`could not read ${file}, so the folder trust is not answered: ${error.message}`);
  }
  return settings?.permissions?.allow ?? [];
}

/**
 * Whether the folder trust on `rows`, in the tab of the bot folder `home`, is
 * one the test may answer: undefined when it may, or why not. `bots` is the
 * throwaway bots folder and `cli` the kit CLI the test runs, which together
 * give the kit's default rules (src/permissions.js `defaultRules`). `extra`
 * are the rules the test itself added to the folder's allow list, as
 * codex-groom-run adds its trust-hooks rule: the set is the defaults and
 * those, exactly.
 */
export const claudeTrustAt = (rows, home, bots, cli, extra = []) => claudeTrustOf(rows, home, {
  allow: claudeAllowIn(home),
  defaults: [...defaultRules(bots, cli), ...extra],
});
