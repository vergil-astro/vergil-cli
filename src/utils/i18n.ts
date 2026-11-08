import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, join } from 'path';
import en from '../locales/en.json' with { type: 'json' };
import zh from '../locales/zh.json' with { type: 'json' };

/**
 * The language vg speaks. Every human-readable message lives in one dictionary per language
 * (src/locales/<lang>.json), shared with the tools in tools/ (see tools/i18n.mjs).
 *
 * Which language, highest priority first:
 *   1. the VG_LANG environment variable (zh | en)
 *   2. the choice saved in the user's config file (`vg lang <zh|en>`, or the first-run prompt)
 *   3. zh
 *
 * Content vg writes into a site (post templates, `vg reset` placeholders) and the directive
 * docs that come from the theme keep their own language; they are not looked up here.
 */
export type Lang = 'zh' | 'en';
export type LangSource = 'env' | 'config' | 'default';
export const LANGS: readonly Lang[] = ['zh', 'en'];
export const DEFAULT_LANG: Lang = 'zh';

/** A message, or its singular and plural forms picked by the `count` variable */
type Message = string | { one: string; other: string };
export type MessageKey = keyof typeof en;
type Vars = Record<string, string | number>;

// Typed against the English keys, so a key missing from zh.json fails the build
const DICTIONARIES: Record<Lang, Record<MessageKey, Message>> = { zh, en };

/** `zh`, `zh-CN`, `en_US.UTF-8` → zh / en; anything else → null */
export function normalizeLang(value: unknown): Lang | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase().split(/[-_.]/)[0];
  return (LANGS as readonly string[]).includes(code) ? (code as Lang) : null;
}

/** $XDG_CONFIG_HOME/vergil/config.json, or ~/.config/vergil/config.json */
export function configFile(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  // The XDG spec says to ignore relative paths
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config');
  return join(base, 'vergil', 'config.json');
}

function readConfig(file: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** The language saved in the config file, or null when none is saved */
export function savedLang(env: NodeJS.ProcessEnv = process.env): Lang | null {
  return normalizeLang(readConfig(configFile(env))?.lang);
}

/** Save the language, keeping anything else in the config file; returns the file's path */
export function saveLang(lang: Lang, env: NodeJS.ProcessEnv = process.env): string {
  const file = configFile(env);
  const config = readConfig(file) ?? {};
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...config, lang }, null, 2)}\n`);
  return file;
}

export function resolveLang(env: NodeJS.ProcessEnv = process.env): { lang: Lang; source: LangSource } {
  const fromEnv = normalizeLang(env.VG_LANG);
  if (fromEnv) return { lang: fromEnv, source: 'env' };
  const saved = savedLang(env);
  if (saved) return { lang: saved, source: 'config' };
  return { lang: DEFAULT_LANG, source: 'default' };
}

let current: Lang = resolveLang().lang;

/** The language this run speaks */
export function currentLang(): Lang {
  return current;
}

/** Switch the language for the rest of this run, e.g. right after the first-run prompt */
export function setLang(lang: Lang): void {
  current = lang;
}

/** A message in the given language, with `{name}` placeholders filled from vars */
export function translate(lang: Lang, key: MessageKey, vars: Vars = {}): string {
  const message = DICTIONARIES[lang][key] ?? DICTIONARIES.en[key] ?? key;
  const text = typeof message === 'string'
    ? message
    : message[typeof vars.count === 'number' && new Intl.PluralRules(lang).select(vars.count) === 'one' ? 'one' : 'other'];
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all));
}

/** A message in the language this run speaks */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(current, key, vars);
}

/** A label and its value on one line: `Label: value`; in Chinese a full-width colon, which brings its own space */
export function withLabel(label: string, value: string, style: (text: string) => string = (text) => text): string {
  return `${style(label)}${label.endsWith('：') ? '' : ' '}${value}`;
}

/** The language's name written in the language this run speaks */
export function langName(lang: Lang): string {
  return t(`lang.name.${lang}`);
}
