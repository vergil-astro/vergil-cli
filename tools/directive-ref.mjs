#!/usr/bin/env node
/**
 * 输出内容指令参考（Markdown），内容来自 src/plugins/directives/schema.mjs，和当前主题版本一致。
 * 给人查，也给 AI 写作助手读。只读不写。
 *
 * 用法：
 *   vg directives ref                    全部指令，外加写法规则、代码块和数学公式
 *   vg directives ref <指令名>...        只看这几个指令，如 vg directives ref callout tabs
 */
import { loadDirectiveSchema } from './theme-schema.mjs';

const { CATEGORIES, DIRECTIVES, DIRECTIVE_MAP, SYNTAX_RULES, EXTRAS } = await loadDirectiveSchema();

const TYPE_LABEL = {
    string: () => '文字',
    number: () => '数字',
    boolean: () => '`true` / `false`',
    color: () => '颜色',
    enum: (a) => a.values.map((v) => `\`${v}\``).join(' | '),
    list: (a) => `逗号分隔：${a.values.map((v) => `\`${v}\``).join('、')}`,
};

const FORM_LABEL = {
    container: (n) => `\`:::${n}{...}\` 开头、单独一行 \`:::\` 结尾`,
    leaf: (n) => `单行 \`::${n}{...}\``,
    text: (n) => `行内 \`:${n}[...]{...}\``,
};

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** 示例里可能有代码块，外层围栏要比里面最长的反引号多一个 */
function fenced(code, lang = 'markdown') {
    const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}${lang}\n${code}\n${fence}`;
}

function renderDirective(d) {
    const out = [`### ${d.name}：${d.summary}`, '', `写法：${d.forms.map((f) => FORM_LABEL[f](d.name)).join('，或')}`, '', fenced(d.example)];
    const attrs = Object.entries(d.attrs);
    if (attrs.length) {
        out.push('', '| 属性 | 取值 | 默认 | 说明 |', '| --- | --- | --- | --- |');
        for (const [key, a] of attrs) {
            const type = TYPE_LABEL[a.type](a) + (a.format && a.type !== 'enum' ? `（${a.format}）` : '');
            const desc = (a.required ? '**必填**。' : '') + a.desc;
            out.push(`| \`${key}\` | ${cell(type)} | ${a.default ? `\`${cell(a.default)}\`` : ''} | ${cell(desc)} |`);
        }
    } else {
        out.push('', '没有属性。');
    }
    for (const group of d.oneOf || []) out.push('', `${group.map((k) => `\`${k}\``).join('、')} 至少写一个。`);
    if (d.body) {
        const cols = d.body.columns ? `；列：${d.body.columns.map((c) => `\`${c}\``).join('、')}` : '';
        const label = d.forms.includes('text') ? '方括号里' : '正文';
        out.push('', `${label}：${d.body.desc}${cols}`);
    }
    if (d.notes?.length) out.push('', ...d.notes.map((n) => `- ${n}`));
    return out.join('\n');
}

function renderAll() {
    const out = [
        '# Vergil 内容指令参考',
        '',
        `由站点所用主题的指令规则生成，和当前主题版本一致。共 ${DIRECTIVES.length} 个指令，按用途分为 ${CATEGORIES.length} 类。写完用 \`vg directives check <文件>\` 检查。`,
        '',
        '## 写法规则',
        '',
        ...SYNTAX_RULES.map((r) => `- ${r}`),
    ];
    for (const category of CATEGORIES) {
        out.push('', `## ${category}`);
        for (const d of DIRECTIVES.filter((x) => x.category === category)) out.push('', renderDirective(d));
    }
    out.push('', '## 不是指令的语法');
    for (const e of EXTRAS) out.push('', `### ${e.title}`, '', fenced(e.example), '', ...e.notes.map((n) => `- ${n}`));
    return out.join('\n');
}

const names = process.argv.slice(2);
if (!names.length) {
    console.log(renderAll());
} else {
    const unknown = names.filter((n) => !DIRECTIVE_MAP.has(n));
    if (unknown.length) {
        console.error(`没有这些指令：${unknown.join('、')}。全部指令：${DIRECTIVES.map((d) => d.name).join('、')}`);
        process.exit(1);
    }
    console.log(names.map((n) => renderDirective(DIRECTIVE_MAP.get(n))).join('\n\n'));
}
