/**
 * Migrations for breaking theme releases. `vg upgrade` runs the ones whose version is above the
 * site's current theme version and at or below the target, in order. Each one must be safe to run
 * twice, because an upgrade can be retried after a failure.
 *
 * None yet: 1.x only makes compatible changes. The first entry comes with the first breaking release.
 */
import type { MessageKey } from '../utils/i18n.js';

export interface Migration {
  /** The theme version that needs this migration, e.g. '2.0.0' */
  version: string;
  /** One line shown before running it: a key in src/locales/*.json, so it is shown in the user's language */
  description: MessageKey;
  run(root: string): Promise<void>;
}

export const MIGRATIONS: Migration[] = [];
