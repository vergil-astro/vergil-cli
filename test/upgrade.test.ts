import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { pickReleaseTag } from '../src/commands/init.js';
import { allowBuildsBlock, mergeAllowBuilds } from '../src/utils/pnpm-settings.js';
import { compareBuilds, normalizeHtml } from '../src/utils/compare-build.js';
import { compareVersions, inRange } from '../src/utils/semver.js';

describe('versions', () => {
  it('compares x.y.z', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('v2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('picks migrations above the current version up to the target', () => {
    const items = [{ version: '3.0.0' }, { version: '2.0.0' }, { version: '1.5.0' }];
    expect(inRange(items, '1.5.0', '3.0.0').map((m) => m.version)).toEqual(['2.0.0', '3.0.0']);
    expect(inRange(items, '1.0.0', '1.9.0').map((m) => m.version)).toEqual(['1.5.0']);
  });

  it('picks the newest release tag at 1.0.0 or later', () => {
    expect(pickReleaseTag(['v0.1.0', 'v1.0.0', 'v1.10.0', 'v1.9.3', 'backup-x'])).toBe('v1.10.0');
    expect(pickReleaseTag(['v0.1.0'])).toBeNull();
  });
});

describe('new site pnpm settings', () => {
  it('takes the allowBuilds block and its comment from the theme repo', () => {
    const yaml = 'packages:\n  - starter\n\n# no install scripts\n# pnpm 11 needs this\nallowBuilds:\n  core-js: false\n  sharp: false\n\nother: 1\n';
    expect(allowBuildsBlock(yaml)).toBe('# no install scripts\n# pnpm 11 needs this\nallowBuilds:\n  core-js: false\n  sharp: false\n');
  });

  it('returns null when there is nothing to take', () => {
    expect(allowBuildsBlock('packages:\n  - starter\n')).toBeNull();
    expect(allowBuildsBlock('allowBuilds:\nother: 1\n')).toBeNull();
  });

  const theme = "# no install scripts\nallowBuilds:\n  sharp: false\n  '@scope/native': false\n  esbuild: false\n";

  it('adds only what the site lacks and keeps the site\'s own decisions', () => {
    const site = "overrides:\n  a: '1'\n\nallowBuilds:\n  sharp: true\n  esbuild: false\n\nother: 1\n";
    const { yaml, added } = mergeAllowBuilds(site, theme);
    expect(added).toEqual(['@scope/native']);
    expect(yaml).toBe("overrides:\n  a: '1'\n\nallowBuilds:\n  sharp: true\n  esbuild: false\n  '@scope/native': false\n\nother: 1\n");
  });

  it('appends the block to a file without one, or writes it to a missing file', () => {
    expect(mergeAllowBuilds('overrides:\n  a: 1\n', theme)).toEqual({ yaml: `overrides:\n  a: 1\n\n${theme}`, added: ['sharp', '@scope/native', 'esbuild'] });
    expect(mergeAllowBuilds(null, theme).yaml).toBe(theme);
  });

  it('changes nothing when the site already declares everything', () => {
    expect(mergeAllowBuilds(theme, theme).added).toEqual([]);
  });
});

describe('build comparison', () => {
  it('ignores what changes on every build', () => {
    const a = '<link href="/_astro/a.B1x2.css"><div data-astro-cid-abc12 id="mind-1793896631241-1" data-payload="AAA">x</div>';
    const b = '<link href="/_astro/a.Zz9.css"><div data-astro-cid-zzz99 id="mind-1793985690886-1" data-payload="BBB">x</div>';
    expect(normalizeHtml(a)).toBe(normalizeHtml(b));
    expect(normalizeHtml('<p>one</p>')).not.toBe(normalizeHtml('<p>two</p>'));
  });

  it('reports changed, missing and added pages', () => {
    const before = mkdtempSync(join(tmpdir(), 'vg-before-'));
    const after = mkdtempSync(join(tmpdir(), 'vg-after-'));
    for (const [dir, pages] of [[before, { 'index.html': '<p>a</p>', 'old/index.html': '<p>o</p>', 'same/index.html': '<p>s</p>' }], [after, { 'index.html': '<p>b</p>', 'new/index.html': '<p>n</p>', 'same/index.html': '<p>s</p>' }]] as const) {
      for (const [rel, html] of Object.entries(pages)) {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), html);
      }
    }
    const diff = compareBuilds(before, after);
    expect(diff.total).toBe(3);
    expect(diff.changed).toEqual(['index.html']);
    expect(diff.missing).toEqual([join('old', 'index.html')]);
    expect(diff.added).toEqual([join('new', 'index.html')]);
  });
});
