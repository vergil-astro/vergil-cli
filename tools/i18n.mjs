/**
 * Messages for the tools, from the same dictionaries as the rest of vg (src/locales/<lang>.json).
 *
 * vg resolves the language (VG_LANG, then the saved choice, then zh) and passes it to every tool
 * as VG_LANG, so a tool only reads that variable. Run on its own without it, a tool speaks zh.
 */
import en from '../src/locales/en.json' with { type: 'json' };
import zh from '../src/locales/zh.json' with { type: 'json' };

const DICTIONARIES = { zh, en };

/** `zh`, `zh-CN`, `en_US.UTF-8` → zh / en; anything else → null, the same rule as src/utils/i18n.ts */
function normalizeLang(value) {
    if (typeof value !== 'string') return null;
    const code = value.trim().toLowerCase().split(/[-_.]/)[0];
    return code in DICTIONARIES ? code : null;
}

export const lang = normalizeLang(process.env.VG_LANG) ?? 'zh';

/** A message with `{name}` placeholders filled from vars; `count` picks the singular or plural form */
export function t(key, vars = {}) {
    const message = DICTIONARIES[lang][key] ?? DICTIONARIES.en[key] ?? key;
    const text =
        typeof message === 'string'
            ? message
            : message[typeof vars.count === 'number' && new Intl.PluralRules(lang).select(vars.count) === 'one' ? 'one' : 'other'];
    return text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all));
}

/** Separator for lists inside a sentence: the ideographic comma in Chinese, a comma in English */
export const listSep = () => t('common.listSep');
