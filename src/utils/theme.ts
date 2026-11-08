import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const THEME = '@vergil-astro/theme';

/**
 * The folder of the theme package this site has installed. It is found through the package's main
 * entry, which every version exports, and not through a subpath like `@vergil-astro/theme/plugins/…`:
 * the package decides which subpaths it exports, and vg must keep working when that list changes.
 */
export function themePackageDir(root: string): string | null {
  try {
    const require = createRequire(join(root, 'package.json'));
    let dir = dirname(require.resolve(THEME));
    for (;;) {
      const pkg = join(dir, 'package.json');
      if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === THEME) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Not resolvable from the site; try the usual install location below
  }
  const direct = join(root, 'node_modules', '@vergil-astro', 'theme');
  return existsSync(join(direct, 'package.json')) ? direct : null;
}

/**
 * Find a file of the theme this site runs. New sites install the theme as the npm package
 * `@vergil-astro/theme`; older template-style sites carry the theme source in their own `src/`.
 * Reading from whichever the site has keeps vg's checks in step with the site's theme version.
 *
 * `rel` is relative to the theme's `src/`, e.g. `plugins/directives/schema.mjs`.
 */
export function resolveThemeFile(root: string, rel: string): string | null {
  const pkgDir = themePackageDir(root);
  if (pkgDir) {
    const file = join(pkgDir, 'src', rel);
    if (existsSync(file)) return file;
  }
  const legacy = join(root, 'src', rel);
  return existsSync(legacy) ? legacy : null;
}
