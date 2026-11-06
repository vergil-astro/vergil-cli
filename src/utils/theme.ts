import { existsSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

/**
 * Find a file of the theme this site runs. New sites install the theme as the npm package
 * `@vergil-astro/theme`; older template-style sites carry the theme source in their own `src/`.
 * Reading from whichever the site has keeps vg's checks in step with the site's theme version.
 *
 * `rel` is relative to the theme's `src/`, e.g. `plugins/directives/schema.mjs`.
 */
export function resolveThemeFile(root: string, rel: string): string | null {
  try {
    const require = createRequire(join(root, 'package.json'));
    return require.resolve(`@vergil-astro/theme/${rel}`);
  } catch {
    // Not installed as a package; fall through to the template layout
  }
  const legacy = join(root, 'src', rel);
  return existsSync(legacy) ? legacy : null;
}
