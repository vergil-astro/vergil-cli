#!/usr/bin/env node
/**
 * Prints the content directive reference (Markdown), built from src/plugins/directives/schema.mjs so it matches the current theme version.
 * For people to look things up, and for AI writing assistants to read. Read-only; writes nothing.
 *
 * The directive text (summaries, attribute docs, examples, notes, syntax rules) comes from the theme
 * and is printed as it is; only the headings and labels around it follow the user's language.
 *
 * Usage:
 *   vg directives ref                    all directives, plus syntax rules, code blocks, and math
 *   vg directives ref <name>...          only these directives, e.g. vg directives ref callout tabs
 */
import { loadDirectiveSchema } from './theme-schema.mjs';
import { listSep, t } from './i18n.mjs';

const { CATEGORIES, DIRECTIVES, DIRECTIVE_MAP, SYNTAX_RULES, EXTRAS } = await loadDirectiveSchema();

const TYPE_LABEL = {
    string: () => t('directives.ref.type.text'),
    number: () => t('directives.ref.type.number'),
    boolean: () => '`true` / `false`',
    color: () => t('directives.ref.type.color'),
    enum: (a) => a.values.map((v) => `\`${v}\``).join(' | '),
    list: (a) => t('directives.ref.type.list', { values: a.values.map((v) => `\`${v}\``).join(listSep()) }),
};

const FORM_LABEL = {
    container: (name) => t('directives.ref.form.container', { name }),
    leaf: (name) => t('directives.ref.form.leaf', { name }),
    text: (name) => t('directives.ref.form.text', { name }),
};

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Examples may contain code blocks, so the outer fence needs one more backtick than the longest run inside */
function fenced(code, lang = 'markdown') {
    const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}${lang}\n${code}\n${fence}`;
}

function renderDirective(d) {
    const forms = d.forms.map((f) => FORM_LABEL[f](d.name)).join(t('directives.ref.formSep'));
    const out = [t('directives.ref.heading', { name: d.name, summary: d.summary }), '', t('directives.ref.syntax', { forms }), '', fenced(d.example)];
    const attrs = Object.entries(d.attrs);
    if (attrs.length) {
        out.push('', t('directives.ref.tableHeader'), '| --- | --- | --- | --- |');
        for (const [key, a] of attrs) {
            const type = TYPE_LABEL[a.type](a) + (a.format && a.type !== 'enum' ? t('directives.ref.format', { format: a.format }) : '');
            const desc = (a.required ? t('directives.ref.required') : '') + a.desc;
            out.push(`| \`${key}\` | ${cell(type)} | ${a.default ? `\`${cell(a.default)}\`` : ''} | ${cell(desc)} |`);
        }
    } else {
        out.push('', t('directives.ref.noAttrs'));
    }
    for (const group of d.oneOf || []) out.push('', t('directives.ref.oneOf', { list: group.map((k) => `\`${k}\``).join(listSep()) }));
    if (d.body) {
        const columns = d.body.columns ? t('directives.ref.columns', { list: d.body.columns.map((c) => `\`${c}\``).join(listSep()) }) : '';
        const label = t(d.forms.includes('text') ? 'directives.ref.labelBrackets' : 'directives.ref.labelBody');
        out.push('', t('directives.ref.bodyLine', { label, desc: d.body.desc, columns }));
    }
    if (d.notes?.length) out.push('', ...d.notes.map((n) => `- ${n}`));
    return out.join('\n');
}

function renderAll() {
    const out = [
        t('directives.ref.title'),
        '',
        t('directives.ref.intro', {
            directives: t('directives.ref.directives', { count: DIRECTIVES.length }),
            categories: t('directives.ref.categories', { count: CATEGORIES.length }),
        }),
        '',
        t('directives.ref.syntaxRules'),
        '',
        ...SYNTAX_RULES.map((r) => `- ${r}`),
    ];
    for (const category of CATEGORIES) {
        out.push('', `## ${category}`);
        for (const d of DIRECTIVES.filter((x) => x.category === category)) out.push('', renderDirective(d));
    }
    out.push('', t('directives.ref.extras'));
    for (const e of EXTRAS) out.push('', `### ${e.title}`, '', fenced(e.example), '', ...e.notes.map((n) => `- ${n}`));
    return out.join('\n');
}

const names = process.argv.slice(2);
if (!names.length) {
    console.log(renderAll());
} else {
    const unknown = names.filter((n) => !DIRECTIVE_MAP.has(n));
    if (unknown.length) {
        console.error(t('directives.ref.unknown', { unknown: unknown.join(listSep()), all: DIRECTIVES.map((d) => d.name).join(listSep()) }));
        process.exit(1);
    }
    console.log(names.map((n) => renderDirective(DIRECTIVE_MAP.get(n))).join('\n\n'));
}
