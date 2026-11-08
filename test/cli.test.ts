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

/** vg with extra environment variables; undefined removes one */
function vgWith(extraEnv: Record<string, string | undefined>, cwd: string, ...args: string[]) {
  const env = { ...process.env, ...extraEnv };
  delete env.FORCE_COLOR;
  for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key];
  const r = spawnSync(process.execPath, ['--import', TSX, ENTRY, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** vg as the test runner sets it up: VG_LANG=en (see vitest.config.ts) */
function vg(cwd: string, ...args: string[]) {
  return vgWith({}, cwd, ...args);
}

const SCHEMA = `
export const CATEGORIES = ['内容展示'];
export const DIRECTIVES = [
  { name: 'callout', category: '内容展示', forms: ['container'], summary: '提示框',
    attrs: { type: { type: 'enum', values: ['info', 'tip'], default: 'info', desc: '类型' } },
    example: ':::callout\\n内容\\n:::' },
];
export const EXTRAS = [{ name: 'code', title: '代码块', example: '\`\`\`ts\\n\`\`\`', notes: [] }];
export const DIRECTIVE_MAP = new Map(DIRECTIVES.map((d) => [d.name, d]));
export const SYNTAX_RULES = ['指令要单独一行'];
export const NAMED_COLORS = [];
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

describe('reset', () => {
  it('writes config that imports the theme types from where the site has them', () => {
    const pkgSite = site();
    writeFileSync(join(pkgSite, 'package.json'), JSON.stringify({ dependencies: { '@vergil-astro/theme': '^1.0.0' } }));
    expect(vg(pkgSite, 'reset').code).toBe(0);
    for (const file of ['notice.ts', 'welcome.ts']) {
      expect(readFileSync(join(pkgSite, 'src/data/config', file), 'utf8')).toMatch(/^import type \{ MemoItem \} from '@vergil-astro\/theme\/types';/);
    }

    // A template-style site carries the theme source, types included
    const legacy = site();
    expect(vg(legacy, 'reset').code).toBe(0);
    expect(readFileSync(join(legacy, 'src/data/config/notice.ts'), 'utf8')).toMatch(/^import type \{ MemoItem \} from '\.\.\/\.\.\/types';/);
  });

  it('keeps the site language and skins, and rebuilds them as plain names', () => {
    const dir = site();
    mkdirSync(join(dir, 'src/data/config'), { recursive: true });
    writeFileSync(join(dir, 'src/data/config/identity.ts'), [
      'export const siteInfo = {',
      "    title: 'Old',",
      "    locale: 'en',",
      "    skin: 'island',",
      "    skins: ['island', 'brutalism', 'bad name'] as string[],",
      '};',
      '',
    ].join('\n'));
    expect(vg(dir, 'reset').code).toBe(0);
    const identity = readFileSync(join(dir, 'src/data/config/identity.ts'), 'utf8');
    expect(identity).toMatch(/^\s*locale: 'en',$/m);
    expect(identity).toMatch(/^\s*skin: 'island',$/m);
    expect(identity).toMatch(/^\s*skins: \['island', 'brutalism'\] as string\[\],$/m);
    expect(identity).not.toMatch(/Old/);
  });

  it('falls back to the defaults when the site has no such settings', () => {
    const dir = site();
    expect(vg(dir, 'reset').code).toBe(0);
    const identity = readFileSync(join(dir, 'src/data/config/identity.ts'), 'utf8');
    expect(identity).toMatch(/^\s*locale: 'zh-CN',$/m);
    expect(identity).toMatch(/^\s*skin: 'classic',$/m);
    expect(identity).toMatch(/^\s*skins: \[\] as string\[\],$/m);
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

describe('language', () => {
  /** An empty config dir, so nothing is saved yet */
  function configHome(lang?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'vg-config-'));
    temps.push(dir);
    if (lang) {
      mkdirSync(join(dir, 'vergil'));
      writeFileSync(join(dir, 'vergil', 'config.json'), JSON.stringify({ lang }));
    }
    return dir;
  }
  function outside(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vg-empty-'));
    temps.push(dir);
    return dir;
  }

  it('speaks zh by default, and does not ask or save anything outside a terminal', () => {
    const home = configHome();
    const r = vgWith({ VG_LANG: undefined, XDG_CONFIG_HOME: home }, outside(), 'list');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/不在 Vergil 站点里/);
    expect(r.stderr).not.toMatch(/Not in a Vergil project/);
    expect(existsSync(join(home, 'vergil', 'config.json'))).toBe(false);
  });

  it('takes the saved language, and VG_LANG over it', () => {
    const home = configHome('en');
    expect(vgWith({ VG_LANG: undefined, XDG_CONFIG_HOME: home }, outside(), 'list').stderr).toMatch(/Not in a Vergil project/);
    expect(vgWith({ VG_LANG: 'zh', XDG_CONFIG_HOME: home }, outside(), 'list').stderr).toMatch(/不在 Vergil 站点里/);
    expect(vgWith({ VG_LANG: 'en', XDG_CONFIG_HOME: configHome('zh') }, outside(), 'list').stderr).toMatch(/Not in a Vergil project/);
  });

  it('vg lang en saves the language in the config dir, and vg lang shows where it comes from', () => {
    const home = configHome();
    const set = vgWith({ VG_LANG: undefined, XDG_CONFIG_HOME: home }, outside(), 'lang', 'en');
    expect(set.code).toBe(0);
    expect(set.stdout).toMatch(/Display language set to English/);
    const file = join(home, 'vergil', 'config.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lang: 'en' });

    const show = vgWith({ VG_LANG: undefined, XDG_CONFIG_HOME: home }, outside(), 'lang');
    expect(show.stdout).toMatch(/Display language: English \(en\)/);
    expect(show.stdout).toContain(file);

    const env = vgWith({ VG_LANG: 'zh', XDG_CONFIG_HOME: home }, outside(), 'lang');
    expect(env.stdout).toMatch(/显示语言：中文（zh）/);
    expect(env.stdout).toMatch(/VG_LANG/);
  });

  it('falls back to ~/.config without XDG_CONFIG_HOME', () => {
    const home = configHome();
    const r = vgWith({ VG_LANG: undefined, XDG_CONFIG_HOME: undefined, HOME: home }, outside(), 'lang', 'zh');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/显示语言已设为中文/);
    expect(JSON.parse(readFileSync(join(home, '.config', 'vergil', 'config.json'), 'utf8'))).toEqual({ lang: 'zh' });
  });

  it('rejects a language it does not know', () => {
    const home = configHome();
    const r = vgWith({ XDG_CONFIG_HOME: home }, outside(), 'lang', 'fr');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Unknown language: fr/);
    expect(existsSync(join(home, 'vergil', 'config.json'))).toBe(false);
  });

  it('passes the language to the tools it runs', () => {
    const dir = site();
    const zh = vgWith({ VG_LANG: undefined, XDG_CONFIG_HOME: configHome() }, dir, 'images', 'check');
    expect(zh.code).toBe(0);
    expect(zh.stdout).toMatch(/没有失效的图片引用/);

    // Saved, not in the environment: only vg resolves it, so the tool hears it through vg
    const en = vgWith({ VG_LANG: undefined, XDG_CONFIG_HOME: configHome('en') }, dir, 'images', 'check');
    expect(en.code).toBe(0);
    expect(en.stdout).toMatch(/Scanned 0 images and 4 content files/);
    expect(en.stdout).toMatch(/No broken image references/);
    expect(en.stdout).not.toMatch(/[\u4e00-\u9fff]/);

    expect(vg(dir, 'directives', 'ref', 'callout').stdout).toMatch(/^### callout: 提示框\n\nSyntax: starts with `:::callout/);
    expect(vgWith({ VG_LANG: 'zh' }, dir, 'directives', 'ref', 'callout').stdout).toMatch(/^### callout：提示框\n\n写法：`:::callout/);
  });

  it('translates commander\'s own errors and help', () => {
    const zh = vgWith({ VG_LANG: 'zh' }, outside(), 'lsit');
    expect(zh.code).toBe(1);
    expect(zh.stderr).toBe("错误：未知命令 'lsit'\n（是不是 list？）\n");
    expect(vg(outside(), 'lsit').stderr).toBe("error: unknown command 'lsit'\n(Did you mean list?)\n");
    const help = vgWith({ VG_LANG: 'zh' }, outside(), 'serve', '--help').stdout;
    expect(help).toMatch(/^用法：/);
    expect(help).toMatch(/\(默认: "4321"\)/);
    expect(help).toMatch(/显示命令帮助/);
  });

  it('keeps --json the same in every language', () => {
    const dir = site();
    for (const args of [['list', '--json'], ['docs', '--json'], ['help', 'callout', '--json']]) {
      expect(vgWith({ VG_LANG: 'zh' }, dir, ...args).stdout, args.join(' ')).toBe(vg(dir, ...args).stdout);
    }
  });
});
