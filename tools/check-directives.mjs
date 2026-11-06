#!/usr/bin/env node
/**
 * 内容指令检查：按站点所用主题的指令规则校验 Markdown 里的指令写法。只读不写。
 *
 * 错误（命令返回失败）：
 *   - 未知的容器指令、单行指令，或者写法不对（比如把 video 写成单行 ::video）
 *   - 以冒号开头、却没被识别成指令的行（冒号后多了空格、属性没写在一行……）
 *   - 未知属性、取值不在范围内、缺少必填属性
 *   - 容器没有闭合
 *   - 正文格式不对：echart 不是合法 JSON、表格缺少必需的列、tabs 里没有 tab: 行……
 * 提示（不影响结果）：
 *   - 内容会被忽略或丢掉的写法，比如没有正文的指令写了正文
 *
 * 行内指令只检查 schema 里登记过的名字。没人认领的行内指令（比如 a:b 里的 :b）渲染时会还原成原文，不算错。
 *
 * 用法：
 *   vg directives check                检查 src/content 下所有 Markdown
 *   vg directives check <文件>...    只检查这几个文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import { loadDirectiveSchema } from './theme-schema.mjs';

const { DIRECTIVES, DIRECTIVE_MAP, NAMED_COLORS } = await loadDirectiveSchema();

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'src/content');
const MD_EXT = '.md';

const parser = remark().use(remarkGfm).use(remarkDirective).use(remarkMath);

const FORM = { containerDirective: 'container', leafDirective: 'leaf', textDirective: 'text' };
const FORM_SYNTAX = {
    container: (name) => `:::${name}{...} 加结尾的 :::`,
    leaf: (name) => `单行 ::${name}{...}`,
    text: (name) => `行内 :${name}[...]{...}`,
};
const PLAN_COLUMN_TYPES = new Set(['text', 'status', 'priority', 'date', 'progress', 'percent', 'number', 'checkbox', 'select', 'link']);
const PLAN_VIEW_NEEDS = {
    timeline: (a) => a.dateCol || a.startDate || a.endDate ? '' : 'dateCol 或 startDate/endDate',
    milestone: (a) => a.dateCol || a.startDate || a.endDate ? '' : 'dateCol',
    ebbinghaus: (a) => a.dateCol || a.startDate || a.endDate ? '' : 'dateCol',
    progress: (a) => a.progressCol ? '' : 'progressCol',
};

// ── 文件 ──

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (path.extname(entry.name).toLowerCase() === MD_EXT) out.push(full);
    }
    return out;
}

/** 命令行传进来的文件：只接受项目内已存在的 .md 文件 */
function resolveArgs(args) {
    const files = [];
    const rejected = [];
    for (const arg of args) {
        const full = path.resolve(ROOT, arg);
        const inside = full === ROOT || full.startsWith(ROOT + path.sep);
        if (!inside) rejected.push(`${arg}（不在项目目录里）`);
        else if (path.extname(full).toLowerCase() !== MD_EXT) rejected.push(`${arg}（不是 .md 文件）`);
        else if (!fs.existsSync(full) || !fs.statSync(full).isFile()) rejected.push(`${arg}（文件不存在）`);
        else files.push(full);
    }
    return { files, rejected };
}

// ── 工具 ──

/** 去掉 frontmatter 但保留换行，行号和原文件对得上 */
function blankFrontmatter(src) {
    const m = src.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
    return m ? m[0].replace(/[^\n]/g, '') + src.slice(m[0].length) : src;
}

const slice = (src, node) => src.slice(node.position.start.offset, node.position.end.offset);

/** 表格单元格的原文，去掉两边的竖线 */
const cellText = (src, cell) => slice(src, cell).trim().replace(/^\|/, '').replace(/\|$/, '').trim();

function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}

function suggest(name) {
    let best = null;
    for (const d of DIRECTIVES) {
        const dist = levenshtein(name.toLowerCase(), d.name);
        if (dist <= 2 && (!best || dist < best.dist)) best = { name: d.name, dist };
    }
    return best ? `，是不是 ${best.name}？` : '';
}

const quoteList = (items) => items.map((v) => `"${v}"`).join('、');

/** 第一个 label 段落是 [方括号] 里的内容，不算正文 */
const bodyChildren = (node) => (node.children || []).filter((c) => !c.data?.directiveLabel);

function findFirst(node, type) {
    let found = null;
    visit({ type: 'root', children: bodyChildren(node) }, type, (n) => {
        if (!found) found = n;
    });
    return found;
}

// ── 属性 ──

function checkValue(spec, value) {
    const v = String(value);
    switch (spec.type) {
        case 'boolean':
            return v === '' || v === 'true' || v === 'false' ? '' : '只能写 "true" 或 "false"';
        case 'enum':
            return spec.values.includes(v) ? '' : `只能是 ${quoteList(spec.values)}`;
        case 'list': {
            const bad = v.split(',').map((s) => s.trim()).filter((s) => s && !spec.values.includes(s));
            return bad.length ? `里的 ${quoteList(bad)} 不认识，可选 ${quoteList(spec.values)}` : '';
        }
        case 'color':
            if (NAMED_COLORS.includes(v)) return '';
            return /[;<>"'{}\\]/.test(v) ? '不是合法的颜色，会被换成默认色' : '';
        default:
            if (spec.pattern && v !== '' && !new RegExp(spec.pattern).test(v)) return `格式应为 ${spec.format || spec.pattern}`;
            return '';
    }
}

function checkAttrs(spec, node, report) {
    const attrs = node.attributes || {};
    const known = Object.keys(spec.attrs);
    for (const [key, value] of Object.entries(attrs)) {
        const attrSpec = spec.attrs[key];
        if (!attrSpec) {
            const hint = known.length ? `，可用属性：${known.join('、')}` : '，它没有属性';
            report('error', `${spec.name} 没有 ${key} 属性${hint}`);
            continue;
        }
        const problem = checkValue(attrSpec, value);
        if (problem) report('error', `${spec.name} 的 ${key}="${value}" ${problem}`);
    }
    for (const [key, attrSpec] of Object.entries(spec.attrs)) {
        if (attrSpec.required && !attrs[key]) report('error', `${spec.name} 缺少必填属性 ${key}`);
    }
    for (const group of spec.oneOf || []) {
        if (!group.some((key) => attrs[key])) report('error', `${spec.name} 至少要写 ${group.join('、')} 中的一个`);
    }
}

// ── 正文 ──

function hasContent(node) {
    return bodyChildren(node).some((c) => c.type !== 'html' || c.value.trim());
}

function checkMarkers(marker) {
    return (node, src, report) => {
        const children = bodyChildren(node);
        const isMarker = (c) => c.type === 'paragraph' && slice(src, c).trim().startsWith(marker);
        const first = children.findIndex(isMarker);
        if (first === -1) {
            report('error', `${node.name} 里没有 \`${marker}\` 行，${marker} 要单独一行、前后空行`);
        } else if (children.slice(0, first).some((c) => c.type !== 'html' || c.value.trim())) {
            report('warn', `${node.name} 第一个 \`${marker}\` 之前的内容会被丢掉`);
        }
    };
}

const BODY_CHECKS = {
    none(node, src, report) {
        if (hasContent(node)) report('warn', `${node.name} 没有正文，写在里面的内容会被忽略`);
    },
    list(node, src, report) {
        if (!findFirst(node, 'list')) report('error', `${node.name} 的正文要写成列表`);
    },
    images(node, src, report) {
        if (!findFirst(node, 'image')) report('warn', `${node.name} 里没有图片，图片写成 ![说明](地址)`);
    },
    table(node, src, report, spec) {
        const table = findFirst(node, 'table');
        if (!table) {
            report('error', `${node.name} 的正文要有一个表格`);
            return;
        }
        const header = table.children[0]?.children.map((cell) => cellText(src, cell).toLowerCase()) || [];
        for (const col of spec.body.requiredColumns || []) {
            if (!header.includes(col)) report('error', `${node.name} 的表格缺少 ${col} 列`);
        }
    },
    json(node, src, report) {
        // 和 charts.mjs 一样取原文：有代码块用代码块，否则拼接所有文本节点
        const code = bodyChildren(node).find((c) => c.type === 'code');
        let raw = '';
        if (code) raw = code.value || '';
        else visit({ type: 'root', children: bodyChildren(node) }, 'text', (t) => { raw += t.value; });
        raw = raw.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        try {
            JSON.parse(raw);
        } catch (e) {
            report('error', `${node.name} 的正文不是合法 JSON：${e.message}`);
        }
    },
};

const NAMED_CHECKS = {
    tabs: checkMarkers('tab:'),
    folders: checkMarkers('folder:'),
    timeline(node, src, report) {
        visit({ type: 'root', children: bodyChildren(node) }, 'listItem', (item) => {
            const text = slice(src, item).replace(/^\s*[-*+]\s*/, '');
            if (text.split('|').length < 2) report('warn', `timeline 的这一项没有 \`|\`，会被丢掉：${text.split('\n')[0].trim()}`, item);
            return 'skip';
        });
    },
    okr(node, src, report) {
        if (!findFirst(node, 'heading')) report('error', 'okr 的每个目标要用 `## 目标` 标题开头');
    },
    plan(node, src, report) {
        const attrs = node.attributes || {};
        const table = findFirst(node, 'table');
        if (table) {
            for (const cell of table.children[0]?.children || []) {
                const header = cellText(src, cell);
                if (!header.includes(':')) continue;
                const type = header.split(':')[1].trim().toLowerCase();
                if (!PLAN_COLUMN_TYPES.has(type)) report('warn', `plan 的列「${header}」类型 ${type} 不认识，会按 text 显示`, cell);
            }
        }
        const views = (attrs.views || 'board,list,table,timeline,milestone,progress').split(',').map((s) => s.trim());
        for (const view of views) {
            const need = PLAN_VIEW_NEEDS[view]?.(attrs);
            if (need) report('warn', `plan 的 ${view} 视图需要 ${need}，没写会被隐藏`);
        }
    },
    photo(node, src, report) {
        if (!(node.attributes || {}).src && !findFirst(node, 'image')) report('error', 'photo 要写 src，或者在正文里放一张图');
    },
};

// ── 主流程 ──

function checkFile(file) {
    const raw = fs.readFileSync(file, 'utf-8');
    const src = blankFrontmatter(raw);
    const lines = src.split('\n');
    const tree = parser.parse(src);
    const problems = [];

    const reportAt = (fallbackNode) => (level, message, node = fallbackNode) => {
        const { line, column } = node.position.start;
        problems.push({ level, line, column, message });
    };

    const directiveLines = new Set();
    const skipLines = new Set();

    visit(tree, (node) => {
        if (node.type === 'code' || node.type === 'html') {
            for (let l = node.position.start.line; l <= node.position.end.line; l++) skipLines.add(l);
            return;
        }
        const form = FORM[node.type];
        if (!form) return;
        const report = reportAt(node);
        if (form !== 'text') directiveLines.add(node.position.start.line);

        const spec = DIRECTIVE_MAP.get(node.name);
        if (!spec) {
            if (form !== 'text') report('error', `未知指令 ${node.name}${suggest(node.name)}`);
            return;
        }
        if (!spec.forms.includes(form)) {
            // 已登记的名字被写成行内（比如 a:video），渲染时会还原成原文，不算错
            if (form !== 'text') {
                const allowed = spec.forms.map((f) => FORM_SYNTAX[f](spec.name)).join(' 或 ');
                report('error', `${spec.name} 不能写成 ${FORM_SYNTAX[form](spec.name)}，要写成 ${allowed}`);
            }
            return;
        }

        checkAttrs(spec, node, report);

        if (form === 'container') {
            const open = lines[node.position.start.line - 1].match(/:{3,}/)?.[0].length ?? 3;
            const close = lines[node.position.end.line - 1].match(/^[\s>]*(:{3,})\s*$/);
            if (node.position.end.line === node.position.start.line || !close || close[1].length < open) {
                report('error', `${spec.name} 没有闭合，要单独一行写 ${':'.repeat(open)}`);
            }
            BODY_CHECKS[spec.body?.kind]?.(node, src, report, spec);
            NAMED_CHECKS[spec.name]?.(node, src, report);
        }
    });

    // 以冒号加名字开头、却没被解析成指令的行
    lines.forEach((text, i) => {
        const line = i + 1;
        if (skipLines.has(line) || directiveLines.has(line)) return;
        const spaced = text.match(/^[\s>]*(:{2,})\s+([a-zA-Z][\w-]*)/);
        if (spaced && DIRECTIVE_MAP.has(spaced[2])) {
            problems.push({ level: 'error', line, column: 1, message: `${spaced[1]} 和 ${spaced[2]} 之间不能有空格` });
            return;
        }
        const m = text.match(/^[\s>]*:{2,}([a-zA-Z][\w-]*)/);
        if (!m || !DIRECTIVE_MAP.has(m[1])) return;
        const reason = text.includes('{') && !text.includes('}') ? '属性要全部写在这一行' : '前面要空一行，属性和引号要成对';
        problems.push({ level: 'error', line, column: 1, message: `这一行没有被识别成 ${m[1]} 指令：${reason}` });
    });

    return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

const args = process.argv.slice(2);
const { files, rejected } = args.length ? resolveArgs(args) : { files: walk(CONTENT_DIR), rejected: [] };
for (const r of rejected) console.error(`跳过 ${r}`);

let errors = 0;
let warnings = 0;
for (const file of files) {
    for (const p of checkFile(file)) {
        if (p.level === 'error') errors++;
        else warnings++;
        console.log(`${path.relative(ROOT, file)}:${p.line}:${p.column}  ${p.level === 'error' ? '错误' : '提示'}  ${p.message}`);
    }
}

console.log(`\n检查了 ${files.length} 个文件：${errors} 个错误，${warnings} 个提示。`);
if (errors > 0 || rejected.length > 0) process.exit(1);
