import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Runs vg the way an agent does: stdout and stderr are pipes, so nothing is a terminal.
 */
const ROOT = resolve(__dirname, '..');
const TSX = pathToFileURL(join(ROOT, 'node_modules/tsx/dist/loader.mjs')).href;
const ENTRY = join(ROOT, 'src/index.ts');

function vg(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  const r = spawnSync(process.execPath, ['--import', TSX, ENTRY, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SCHEMA = `
export const CATEGORIES = ['内容展示'];
export const DIRECTIVES = [
  { name: 'callout', category: '内容展示', forms: ['container'], summary: '提示框',
    attrs: { type: { type: 'enum', values: ['info', 'tip'], default: 'info', desc: '类型' } },
    example: ':::callout\\n内容\\n:::' },
];
export const EXTRAS = [{ name: 'code', title: '代码块', example: '\`\`\`ts\\n\`\`\`', notes: [] }];
`;

const temps: string[] = [];
function site(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vg-cli-'));
  temps.push(dir);
  const files: Record<string, string> = {
    'astro.config.mjs': 'export default {}\n',
    'src/content/blog/hello.md': "---\ntitle: 'Hello'\npublishDate: '2026-01-02'\ndraft: false\ntags:\n  - 'a'\n---\n\nbody\n",
    'src/content/blog/wip.md': "---\ntitle: 'Work in progress'\npublishDate: '2026-01-03'\ndraft: true\n---\n\nbody\n",
    'src/content/docs/guide/_meta.md': "---\ntitle: 'Guide'\n---\n",
    'src/content/docs/guide/intro.md': "---\ntitle: 'Intro'\n---\n",
    'src/plugins/directives/schema.mjs': SCHEMA,
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe('--json', () => {
  it('lists content types and items', () => {
    const dir = site();
    const summary = vg(dir, 'list', '--json');
    expect(summary.code).toBe(0);
    expect(JSON.parse(summary.stdout)).toEqual({
      draftsOnly: false,
      types: [{ type: 'post', dir: 'src/content/blog', total: 2, drafts: 1 }],
      total: 2,
      drafts: 1,
    });

    const drafts = JSON.parse(vg(dir, 'list', 'post', '-d', '--json').stdout);
    expect(drafts.items).toEqual([
      { title: 'Work in progress', path: 'src/content/blog/wip.md', date: '2026-01-03', draft: true, tags: [] },
    ]);
  });

  it('lists docs books and a book tree', () => {
    const dir = site();
    expect(JSON.parse(vg(dir, 'docs', '--json').stdout).books).toEqual([
      { id: 'guide', title: 'Guide', path: 'src/content/docs/guide', docs: 1, drafts: 0 },
    ]);
    const tree = JSON.parse(vg(dir, 'docs', 'show', 'guide', '--json').stdout);
    expect(tree).toMatchObject({ book: 'guide', docs: 1, children: [{ type: 'doc', title: 'Intro', path: 'src/content/docs/guide/intro.md' }] });
  });

  it('reads directive help from the site schema', () => {
    const dir = site();
    const all = JSON.parse(vg(dir, 'help', '--json').stdout);
    expect(all.count).toBe(1);
    expect(all.categories[0].directives).toEqual([{ name: 'callout', summary: '提示框' }]);
    expect(JSON.parse(vg(dir, 'help', 'callout', '--json').stdout).attrs.type.values).toEqual(['info', 'tip']);
  });
});

describe('failures', () => {
  it('exit non-zero with the message on stderr and nothing on stdout', () => {
    const dir = site();
    for (const args of [['list', 'nope'], ['help', 'nope'], ['series', 'show', 'nope'], ['docs', '../..'], ['publish', 'nope']]) {
      const r = vg(dir, ...args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stdout, args.join(' ')).toBe('');
      expect(r.stderr, args.join(' ')).toMatch(/✗/);
    }
  });

  it('fail outside a site', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vg-empty-'));
    temps.push(dir);
    const r = vg(dir, 'list');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Not in a Vergil project/);
  });

  it('reject values that would reach a shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vg-empty-'));
    temps.push(dir);
    expect(vg(dir, 'init', '-t', 'a/b;touch pwned', '--skip-install', '--skip-serve').code).toBe(1);
    expect(vg(site(), 'serve', '--port', '1;echo hi').code).toBe(1);
  });
});

describe('init', () => {
  /** A theme checkout as vg init reads it: the package, its pnpm settings and starter/ */
  function themeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vg-theme-'));
    temps.push(dir);
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: '@vergil-astro/theme', version: '1.2.3' }),
      'pnpm-workspace.yaml': 'packages:\n  - starter\n\n# no install scripts\nallowBuilds:\n  sharp: false\n',
      'starter/package.json': JSON.stringify({ name: 'vergil-starter', dependencies: { '@vergil-astro/theme': 'workspace:*' } }),
      'starter/astro.config.mjs': 'export default {}\n',
      'starter/src/content/blog/hello.md': '---\ntitle: Hello\n---\n',
    };
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return dir;
  }

  it('creates the site in a new folder named after it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vg-empty-'));
    temps.push(cwd);
    const r = vg(cwd, 'init', 'my-site', '--from', themeRepo(), '--skip-install', '--skip-serve');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/cd my-site/);
    const pkg = JSON.parse(readFileSync(join(cwd, 'my-site', 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-site');
    expect(pkg.dependencies['@vergil-astro/theme']).toBe('^1.2.3');
    expect(readFileSync(join(cwd, 'my-site', 'pnpm-workspace.yaml'), 'utf8')).toBe('# no install scripts\nallowBuilds:\n  sharp: false\n');
    expect(readFileSync(join(cwd, 'my-site', 'src/content/blog/hello.md'), 'utf8')).toMatch(/Hello/);
  });

  it('keeps the new folder inside the current directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vg-empty-'));
    temps.push(cwd);
    const r = vg(cwd, 'init', '../escaped-site', '--from', themeRepo(), '--skip-install', '--skip-serve');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/inside the current directory/);
    expect(existsSync(join(cwd, '..', 'escaped-site'))).toBe(false);
  });
});

describe('outside a terminal', () => {
  it('does not prompt: publish without a slug fails and lists the drafts', () => {
    const dir = site();
    const r = vg(dir, 'publish');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/vg publish <slug>/);
    expect(r.stderr).toMatch(/wip/);
    expect(readFileSync(join(dir, 'src/content/blog/wip.md'), 'utf8')).toMatch(/draft: true/);
  });

  it('publishes by slug', () => {
    const dir = site();
    const r = vg(dir, 'publish', 'wip');
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, 'src/content/blog/wip.md'), 'utf8')).toMatch(/draft: false/);
  });

  it('prints no colors, hyperlinks or banner', () => {
    const dir = site();
    expect(vg(dir, 'list', 'post').stdout).not.toMatch(/\x1b/);
    expect(vg(dir).stdout).not.toMatch(/██/);
  });
});
