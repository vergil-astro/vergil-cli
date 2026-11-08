import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { describe, expect, it } from 'vitest';
import { resolveThemeFile, themePackageDir } from '../src/utils/theme.js';

function write(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe('finding the theme files', () => {
  it('reads files the theme package does not export, like theme 1.0.1 does', () => {
    const root = mkdtempSync(join(tmpdir(), 'vg-theme-'));
    const pkg = join(root, 'node_modules', '@vergil-astro', 'theme');
    write(join(root, 'package.json'), JSON.stringify({ name: 'site', dependencies: { '@vergil-astro/theme': '^1.0.0' } }));
    write(join(pkg, 'package.json'), JSON.stringify({ name: '@vergil-astro/theme', type: 'module', exports: { '.': './src/integration.ts', './types': './src/types.ts' } }));
    write(join(pkg, 'src', 'integration.ts'), 'export default () => ({});\n');
    write(join(pkg, 'src', 'plugins', 'directives', 'schema.mjs'), 'export const DIRECTIVES = [];\n');
    write(join(pkg, 'src', 'appearance', 'contract.json'), '{"version":1}\n');

    expect(realpathSync(themePackageDir(root)!)).toBe(realpathSync(pkg));
    expect(resolveThemeFile(root, 'plugins/directives/schema.mjs')).toBe(join(realpathSync(pkg), 'src', 'plugins', 'directives', 'schema.mjs'));
    expect(resolveThemeFile(root, 'appearance/contract.json')).toBe(join(realpathSync(pkg), 'src', 'appearance', 'contract.json'));
  });

  it('falls back to a template-style site that carries the theme in src/', () => {
    const root = mkdtempSync(join(tmpdir(), 'vg-theme-'));
    write(join(root, 'package.json'), JSON.stringify({ name: 'old-site' }));
    write(join(root, 'src', 'plugins', 'directives', 'schema.mjs'), 'export const DIRECTIVES = [];\n');
    expect(themePackageDir(root)).toBeNull();
    expect(resolveThemeFile(root, 'plugins/directives/schema.mjs')).toBe(join(root, 'src', 'plugins', 'directives', 'schema.mjs'));
    expect(resolveThemeFile(root, 'appearance/contract.json')).toBeNull();
  });
});
