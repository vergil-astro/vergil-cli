import readline from 'readline';
import { C } from '../utils/helpers.js';
import {
  configFile, langName, normalizeLang, resolveLang, saveLang, savedLang, setLang, t, translate,
  type Lang,
} from '../utils/i18n.js';
import { canPrompt, fail, warn } from '../utils/output.js';

/** Runs that must not stop for a question: machine-readable output, help and version */
const NO_PROMPT_ARGS = new Set(['--json', '--help', '-h', '--version', '-v']);

const otherLang = (lang: Lang): Lang => (lang === 'zh' ? 'en' : 'zh');

/**
 * Ask for the language the first time vg runs in a terminal: a person is there to answer, no
 * language is saved yet and VG_LANG doesn't pick one. `vg lang` itself is the explicit way to
 * set it, so it never asks.
 */
export function shouldAskLanguage(args: string[], env: NodeJS.ProcessEnv = process.env, interactive = canPrompt): boolean {
  if (!interactive || env.VG_LANG || savedLang(env)) return false;
  if (args[0] === 'lang') return false;
  return !args.some((arg) => NO_PROMPT_ARGS.has(arg));
}

/** '' (just Enter), 1 or zh → zh; 2 or en → en; anything else → null */
export function parseLanguageAnswer(answer: string): Lang | null {
  const value = answer.trim();
  if (value === '' || value === '1') return 'zh';
  if (value === '2') return 'en';
  return normalizeLang(value);
}

/** One question; null when the input closes (Ctrl+D) before an answer */
function ask(rl: readline.Interface, query: string): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = () => resolve(null);
    rl.once('close', onClose);
    rl.question(query, (answer) => {
      rl.off('close', onClose);
      resolve(answer);
    });
  });
}

/**
 * The first-run question. It is asked before vg knows the language, so it is bilingual,
 * with each half taken from that language's dictionary.
 */
export async function askLanguage(): Promise<void> {
  const both = (key: 'lang.prompt.title' | 'lang.prompt.input' | 'lang.prompt.invalid', vars = {}) =>
    `${translate('zh', key, vars)} / ${translate('en', key, vars)}`;
  // Each option is labelled in its own language
  const zhName = translate('zh', 'lang.name.zh');
  const enName = translate('en', 'lang.name.en');

  console.log(C.accent(`${both('lang.prompt.title')}:`));
  console.log(`  1) ${zhName}`);
  console.log(`  2) ${enName}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => {
    rl.close();
    process.stdout.write('\n');
    process.exit(130);
  });

  let lang: Lang | null = null;
  try {
    for (;;) {
      const answer = await ask(rl, `${both('lang.prompt.input', { default: zhName })}: `);
      // Input closed without an answer: keep the default for this run and ask again next time
      if (answer === null) return;
      lang = parseLanguageAnswer(answer);
      if (lang) break;
      console.log(C.warning(both('lang.prompt.invalid')));
    }
  } finally {
    rl.close();
  }

  setLang(lang);
  try {
    saveLang(lang);
  } catch (error) {
    warn(t('lang.saveFailed', { path: configFile(), error: (error as Error).message }));
    console.log();
    return;
  }
  console.log(C.success(t('lang.set', { name: langName(lang) })));
  console.log(C.muted(`  ${t('lang.switchHint', { other: otherLang(lang) })}`));
  console.log();
}

/** `vg lang` shows the language and where it comes from; `vg lang <zh|en>` saves one */
export function langCommand(value?: string): void {
  if (value === undefined) {
    const { lang, source } = resolveLang();
    console.log(t('lang.current', { name: langName(lang), code: lang }));
    const from = source === 'env'
      ? t('lang.source.env')
      : source === 'config' ? t('lang.savedIn', { path: configFile() }) : t('lang.source.default');
    console.log(C.muted(`  ${from}`));
    console.log(C.muted(`  ${t('lang.switchHint', { other: otherLang(lang) })}`));
    return;
  }

  const lang = normalizeLang(value);
  if (!lang) return fail(t('lang.unknown', { lang: value }), t('common.available', { list: 'zh, en' }));

  let file: string;
  try {
    file = saveLang(lang);
  } catch (error) {
    return fail(t('lang.saveFailed', { path: configFile(), error: (error as Error).message }));
  }
  // Answer in the language that now applies; VG_LANG can still override the saved one
  const resolved = resolveLang();
  setLang(resolved.lang);
  console.log(C.success(t('lang.set', { name: langName(lang) })));
  console.log(C.muted(`  ${t('lang.savedIn', { path: file })}`));
  if (resolved.lang !== lang) warn(t('lang.envOverrides', { value: String(process.env.VG_LANG) }));
}
