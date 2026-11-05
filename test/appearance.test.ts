import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveName, installFiles, packageDir, parseSource, readDefaultSkin, readNameList,
  readSourceRecord, scanFiles, validatePackage, writeDefaultSkin, writeNameList,
} from '../src/utils/appearance.js';

const temps: string[] = [];
function tempDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'vg-test-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe('parseSource', () => {
  it('maps a bare name to the official repo', () => {
    expect(parseSource('island', 'skin')).toEqual({ type: 'github', owner: 'vergil-astro', repo: 'vergil-skin-island', ref: undefined });
    expect(parseSource('ocean', 'scheme')).toMatchObject({ repo: 'vergil-scheme-ocean' });
  });
  it('reads owner/repo with an optional ref', () => {
    expect(parseSource('someone/fancy-skin#v1.2.0', 'skin')).toEqual({ type: 'github', owner: 'someone', repo: 'fancy-skin', ref: 'v1.2.0' });
  });
  it('reads local folders', () => {
    expect(parseSource('./skins-src/x', 'skin', '/site')).toEqual({ type: 'local', path: '/site/skins-src/x' });
    expect(parseSource('/abs/x', 'skin')).toEqual({ type: 'local', path: '/abs/x' });
  });
  it('rejects unsafe or malformed input', () => {
    expect(() => parseSource('Island', 'skin')).toThrow(/not a valid skin name/);
    expect(() => parseSource('a/b/c', 'skin')).toThrow(/Can't read/);
    expect(() => parseSource('owner/..', 'skin')).toThrow(/Can't read/);
    expect(() => parseSource('owner/repo#../x', 'skin')).toThrow(/not a valid git ref/);
    expect(() => parseSource('owner/re po', 'skin')).toThrow(/Can't read/);
    expect(() => parseSource('  ', 'skin')).toThrow(/Missing/);
  });
});

describe('deriveName', () => {
  it('strips the official prefix and lowercases', () => {
    expect(deriveName({ type: 'github', owner: 'o', repo: 'vergil-skin-island' }, 'skin')).toBe('island');
    expect(deriveName({ type: 'github', owner: 'o', repo: 'Fancy-Skin' }, 'skin')).toBe('fancy-skin');
    expect(deriveName({ type: 'local', path: '/x/brutalism' }, 'skin')).toBe('brutalism');
  });
  it('returns null when the name would be invalid', () => {
    expect(deriveName({ type: 'github', owner: 'o', repo: 'my_skin.v2' }, 'skin')).toBeNull();
  });
});

describe('scanFiles', () => {
  it('keeps data and styles, leaves out scripts, dotfiles, node_modules and links', () => {
    const dir = tempDir({
      'skin.json': '{}', 'skin.css': '', 'styles/a.css': '', 'README.md': '', 'LICENSE': '', 'fonts/x.woff2': '',
      'build.js': '', 'install.sh': '', 'package.json': '{}', '.github/workflows/ci.yml': '', '.gitignore': '',
      'node_modules/pkg/index.css': '',
    });
    symlinkSync('/etc/hosts', join(dir, 'hosts.css'));
    const { files, skipped } = scanFiles(dir);
    expect(files).toEqual(['LICENSE', 'README.md', 'fonts/x.woff2', 'package.json', 'skin.css', 'skin.json', 'styles/a.css']);
    expect(skipped).toEqual(expect.arrayContaining(['build.js', 'install.sh', '.github', '.gitignore', 'node_modules', 'hosts.css']));
  });
});

describe('validatePackage', () => {
  const skin = (manifest: object, extra: Record<string, string> = {}) => {
    const dir = tempDir({ 'skin.json': JSON.stringify(manifest), 'skin.css': '', ...extra });
    return validatePackage(dir, scanFiles(dir).files, 'skin', 1);
  };
  it('accepts a valid skin with a bundled scheme', () => {
    expect(skin({ contract: 1, schemes: [{ id: 'mint', short: 'T', swatch: '#00aa88' }] }, { 'schemes/mint.css': '' })).toEqual([]);
  });
  it('reports every problem', () => {
    expect(skin({ contract: 2, schemes: [{ id: 'mint', short: 'TOO', swatch: 'red;x' }] })).toEqual([
      'skin.json targets appearance contract 2, this site uses 1',
      'skin.json schemes[0]: short should be 1-2 letters or digits',
      'skin.json schemes[0]: swatch should be a hex color or a CSS variable',
      'missing schemes/mint.css',
    ]);
  });
  it('needs the manifest and the CSS entry', () => {
    const dir = tempDir({ 'skin.css': '' });
    expect(validatePackage(dir, scanFiles(dir).files, 'skin', 1)).toEqual(['missing skin.json']);
    const dir2 = tempDir({ 'scheme.json': JSON.stringify({ contract: 1, short: 'O', swatch: '#0066cc' }) });
    expect(validatePackage(dir2, scanFiles(dir2).files, 'scheme', 1)).toEqual(['missing scheme.css']);
  });
});

describe('installFiles', () => {
  it('copies only the listed files, records the source and replaces an old install', () => {
    const site = tempDir();
    const from = tempDir({ 'skin.json': '{}', 'skin.css': 'a{}', 'styles/b.css': '', 'evil.js': '' });
    const target = installFiles(site, 'skin', 'demo', from, ['skin.json', 'skin.css', 'styles/b.css'], { type: 'local', path: from });
    expect(target).toBe(join(site, 'skins', 'demo'));
    expect(existsSync(join(target, 'evil.js'))).toBe(false);
    expect(readFileSync(join(target, 'skin.css'), 'utf8')).toBe('a{}');
    expect(readSourceRecord(target)?.source).toEqual({ type: 'local', path: from });
    installFiles(site, 'skin', 'demo', from, ['skin.json', 'skin.css'], { type: 'local', path: from });
    expect(existsSync(join(target, 'styles'))).toBe(false);
  });
  it('refuses names that would leave skins/', () => {
    expect(() => packageDir(tempDir(), 'skin', '../evil')).toThrow();
  });
});

describe('identity.ts edits', () => {
  const identity = [
    'export const siteInfo = {',
    "    skin: 'classic',",
    "    skins: ['island', 'brutalism'] as string[],",
    '    schemes: [] as string[],',
    "    subtitle: 'costs $5 / $& month',",
    '};',
  ].join('\n');

  it('reads the lists and the default skin', () => {
    expect(readNameList(identity, 'skins')).toEqual(['island', 'brutalism']);
    expect(readNameList(identity, 'schemes')).toEqual([]);
    expect(readDefaultSkin(identity)).toBe('classic');
  });
  it('rewrites a list in place and keeps the rest of the line', () => {
    const next = writeNameList(identity, 'skins', ['island', 'brutalism', 'fancy'])!;
    expect(next).toContain("    skins: ['island', 'brutalism', 'fancy'] as string[],");
    expect(next).toContain("    skin: 'classic',");
    expect(next).toContain("costs $5 / $& month");
  });
  it('sets the default skin without touching skins', () => {
    const next = writeDefaultSkin(identity, 'island')!;
    expect(next).toContain("    skin: 'island',");
    expect(readNameList(next, 'skins')).toEqual(['island', 'brutalism']);
  });
  it('adds a missing list after skin: for older identity files', () => {
    const old = "export const siteInfo = {\n    skin: 'island',\n};";
    const next = writeNameList(old, 'skins', ['island'])!;
    expect(next).toBe("export const siteInfo = {\n    skin: 'island',\n    skins: ['island'] as string[],\n};");
    expect(writeNameList('const x = {};', 'skins', ['a'])).toBeNull();
  });
});
