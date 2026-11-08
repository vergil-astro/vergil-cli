/**
 * Reads the directive rules (schema.mjs) of the theme the site uses, so vg's checks match the theme version the site actually has installed.
 * Looks for the site's installed npm package @vergil-astro/theme first; if it is not found, falls back to the old template-style site (theme source directly in the site's src/).
 *
 * Same approach as src/utils/theme.ts: find the package directory through the theme package's main entry, then read the files under src/
 * without going through @vergil-astro/theme/<subpath>, so however the theme adjusts its exports, vg is not affected.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { t } from './i18n.mjs';

const THEME = '@vergil-astro/theme';
const SCHEMA = 'plugins/directives/schema.mjs';

function themePackageDir(root) {
    try {
        const require = createRequire(path.join(root, 'package.json'));
        let dir = path.dirname(require.resolve(THEME));
        for (;;) {
            const pkg = path.join(dir, 'package.json');
            if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === THEME) return dir;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    } catch {}
    const direct = path.join(root, 'node_modules', '@vergil-astro', 'theme');
    return existsSync(path.join(direct, 'package.json')) ? direct : null;
}

export async function loadDirectiveSchema(root = process.cwd()) {
    const pkgDir = themePackageDir(root);
    const candidates = [pkgDir && path.join(pkgDir, 'src', SCHEMA), path.join(root, 'src', SCHEMA)].filter(Boolean);
    for (const file of candidates) {
        if (existsSync(file)) return import(pathToFileURL(file).href);
    }
    console.error(t('schema.notFound'));
    process.exit(1);
}
