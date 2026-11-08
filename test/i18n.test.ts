import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import en from '../src/locales/en.json' with { type: 'json' };
import zh from '../src/locales/zh.json' with { type: 'json' };
import { parseLanguageAnswer, shouldAskLanguage } from '../src/commands/lang.js';
import { translateCommanderError } from '../src/utils/commander-i18n.js';
import {
  configFile, currentLang, normalizeLang, resolveLang, saveLang, savedLang, setLang, translate,
} from '../src/utils/i18n.js';

const ROOT = resolve(__dirname, '..');
type Dict = Record<string, string | { one: string; other: string }>;

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vg-i18n-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

/** The {placeholders} of a message, all forms together */
function placeholders(message: Dict[string]): string[] {
  const text = typeof message === 'string' ? message : `${message.one} ${message.other}`;
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/** Message keys passed literally to t() or translate() in src/ and tools/ */
function usedKeys(): Map<string, string> {
  const files = [
    ...readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts')).map((f) => join(ROOT, 'src', f)),
    ...readdirSync(join(ROOT, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => join(ROOT, 'tools', f)),
  ];
  const keys = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // The first argument of t(...) or the second of translate(lang, ...); a ternary there may name two keys
    for (const m of text.matchAll(/\b(?:t\(|translate\([^,()]+,)([^,()]*)/g)) {
      for (const k of m[1].matchAll(/'([a-zA-Z]+(?:\.[a-zA-Z0-9]+)+)'/g)) keys.set(k[1], file);
    }
  }
  return keys;
}

describe('dictionaries', () => {
  const dicts: Record<string, Dict> = { zh, en };

  it('have the same keys in every language', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('use the same placeholders in every language, and plural forms have both forms', () => {
    for (const key of Object.keys(en)) {
      expect(placeholders((zh as Dict)[key]), key).toEqual(placeholders((en as Dict)[key]));
      for (const dict of Object.values(dicts)) {
        const message = dict[key];
        if (typeof message !== 'string') expect(Object.keys(message).sort(), key).toEqual(['one', 'other']);
      }
    }
  });

  it('have every key the code asks for', () => {
    const keys = usedKeys();
    expect(keys.size).toBeGreaterThan(300);
    for (const [key, file] of keys) expect(key in en, `${key} in ${file}`).toBe(true);
  });
});

describe('translate', () => {
  it('fills placeholders and picks the plural form', () => {
    expect(translate('en', 'common.drafts', { count: 1 })).toBe('(1 draft)');
    expect(translate('en', 'common.drafts', { count: 2 })).toBe('(2 drafts)');
    expect(translate('zh', 'common.drafts', { count: 2 })).toBe('（2 个草稿）');
    expect(translate('en', 'new.created', { type: 'post', path: 'a.md' })).toBe('✓ post created: a.md');
  });
});

describe('choosing the language', () => {
  it('reads zh and en, with or without a region', () => {
    expect(normalizeLang('zh')).toBe('zh');
    expect(normalizeLang('EN')).toBe('en');
    expect(normalizeLang('zh-CN')).toBe('zh');
    expect(normalizeLang('en_US.UTF-8')).toBe('en');
    expect(normalizeLang('fr')).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
  });

  it('keeps the config in the user config dir', () => {
    expect(configFile({ XDG_CONFIG_HOME: '/x/config' })).toBe(join('/x/config', 'vergil', 'config.json'));
    // A relative XDG_CONFIG_HOME is ignored, as the XDG spec says
    expect(configFile({ XDG_CONFIG_HOME: 'relative' })).toBe(join(homedir(), '.config', 'vergil', 'config.json'));
    expect(configFile({})).toBe(join(homedir(), '.config', 'vergil', 'config.json'));
  });

  it('defaults to zh, then takes the saved language, then VG_LANG', () => {
    const env = { XDG_CONFIG_HOME: tempDir() };
    expect(resolveLang(env)).toEqual({ lang: 'zh', source: 'default' });
    saveLang('en', env);
    expect(savedLang(env)).toBe('en');
    expect(resolveLang(env)).toEqual({ lang: 'en', source: 'config' });
    expect(resolveLang({ ...env, VG_LANG: 'zh' })).toEqual({ lang: 'zh', source: 'env' });
    // A value vg doesn't know is ignored
    expect(resolveLang({ ...env, VG_LANG: 'fr' })).toEqual({ lang: 'en', source: 'config' });
  });

  it('takes a clear system locale when nothing is saved, but not C or POSIX', () => {
    const dir = tempDir();
    expect(resolveLang({ XDG_CONFIG_HOME: dir, LANG: 'en_US.UTF-8' })).toEqual({ lang: 'en', source: 'system' });
    expect(resolveLang({ XDG_CONFIG_HOME: dir, LANG: 'zh_CN.UTF-8' })).toEqual({ lang: 'zh', source: 'system' });
    expect(resolveLang({ XDG_CONFIG_HOME: dir, LANG: 'C.UTF-8' })).toEqual({ lang: 'zh', source: 'default' });
    // LC_ALL overrides LANG, even when it names no language (POSIX order)
    expect(resolveLang({ XDG_CONFIG_HOME: dir, LC_ALL: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' })).toEqual({ lang: 'zh', source: 'system' });
    expect(resolveLang({ XDG_CONFIG_HOME: dir, LC_ALL: 'C', LANG: 'en_US.UTF-8' })).toEqual({ lang: 'zh', source: 'default' });
    // A saved choice beats the system locale
    saveLang('zh', { XDG_CONFIG_HOME: dir });
    expect(resolveLang({ XDG_CONFIG_HOME: dir, LANG: 'en_US.UTF-8' })).toEqual({ lang: 'zh', source: 'config' });
  });

  it('keeps other settings in the config file', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'vergil'));
    writeFileSync(join(dir, 'vergil', 'config.json'), '{ "other": 1 }');
    saveLang('zh', { XDG_CONFIG_HOME: dir });
    expect(JSON.parse(readFileSync(join(dir, 'vergil', 'config.json'), 'utf8'))).toEqual({ other: 1, lang: 'zh' });
  });
});

describe('first-run prompt', () => {
  const empty = () => ({ XDG_CONFIG_HOME: tempDir() });

  it('asks in a terminal when nothing is saved and VG_LANG is not set', () => {
    expect(shouldAskLanguage(['list'], empty(), true)).toBe(true);
    expect(shouldAskLanguage([], empty(), true)).toBe(true);
  });

  it('does not ask outside a terminal, with VG_LANG, once saved, or for json, help, version and vg lang', () => {
    expect(shouldAskLanguage(['list'], empty(), false)).toBe(false);
    expect(shouldAskLanguage(['list'], { ...empty(), VG_LANG: 'en' }, true)).toBe(false);
    const saved = empty();
    saveLang('en', saved);
    expect(shouldAskLanguage(['list'], saved, true)).toBe(false);
    for (const args of [['list', '--json'], ['--help'], ['new', '-h'], ['--version'], ['-v'], ['lang'], ['lang', 'en']]) {
      expect(shouldAskLanguage(args, empty(), true), args.join(' ')).toBe(false);
    }
  });

  it('does not ask when run from a package script or in CI, even with a terminal attached', () => {
    // pnpm build runs `vg images organize`; hosting platforms like EdgeOne give the build a terminal
    expect(shouldAskLanguage(['images', 'organize'], { ...empty(), npm_lifecycle_event: 'build' }, true)).toBe(false);
    expect(shouldAskLanguage(['list'], { ...empty(), CI: 'true' }, true)).toBe(false);
    expect(shouldAskLanguage(['list'], { ...empty(), CI: '1' }, true)).toBe(false);
    // An explicit "not CI" still asks
    expect(shouldAskLanguage(['list'], { ...empty(), CI: 'false' }, true)).toBe(true);
    expect(shouldAskLanguage(['list'], { ...empty(), CI: '0' }, true)).toBe(true);
  });

  it('reads the answer: Enter or 1 is zh, 2 is en', () => {
    expect(parseLanguageAnswer('')).toBe('zh');
    expect(parseLanguageAnswer(' 1 ')).toBe('zh');
    expect(parseLanguageAnswer('2')).toBe('en');
    expect(parseLanguageAnswer('en')).toBe('en');
    expect(parseLanguageAnswer('3')).toBeNull();
  });
});

describe('commander errors', () => {
  it('keep commander\'s English in en, and translate it in zh', () => {
    const text = "error: unknown command 'lsit'\n(Did you mean list?)\n";
    expect(translateCommanderError(text)).toBe(text);
    const many = "error: too many arguments for 'list'. Expected 1 argument but got 2: a, b.";
    expect(translateCommanderError(many)).toBe(many);

    const before = currentLang();
    setLang('zh');
    try {
      expect(translateCommanderError(text)).toBe("错误：未知命令 'lsit'\n（是不是 list？）\n");
      expect(translateCommanderError(many)).toBe("错误：'list' 的参数太多，应为 1 个，实际有 2 个：a, b。");
      expect(translateCommanderError('something else')).toBe('something else');
    } finally {
      setLang(before);
    }
  });
});
