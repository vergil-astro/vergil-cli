#!/usr/bin/env node
/**
 * Content directive check: validates directive syntax in Markdown against the directive rules of the theme the site uses. Read-only; writes nothing.
 *
 * Errors (the command fails):
 *   - unknown container or leaf directives, or the wrong form (e.g. video written as a single-line ::video)
 *   - lines that start with a colon but were not recognized as a directive (extra space after the colons, attributes not on one line, ...)
 *   - unknown attributes, values out of range, missing required attributes
 *   - unclosed containers
 *   - malformed body: echart is not valid JSON, a table is missing a required column, tabs has no tab: line, ...
 * Warnings (do not affect the result):
 *   - content that will be ignored or dropped, e.g. a body written inside a directive that takes no body
 *
 * Text directives are only checked for names registered in the schema. Unclaimed text directives (e.g. the :b in a:b) render back as the original text, so they are not errors.
 *
 * Usage:
 *   vg directives check                check all Markdown under src/content
 *   vg directives check <file>...      only check these files
 */
import fs from 'node:fs';
import path from 'node:path';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import { loadDirectiveSchema } from './theme-schema.mjs';
import { listSep, t } from './i18n.mjs';

const { DIRECTIVES, DIRECTIVE_MAP, NAMED_COLORS } = await loadDirectiveSchema();

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'src/content');
const MD_EXT = '.md';

const parser = remark().use(remarkGfm).use(remarkDirective).use(remarkMath);

const FORM = { containerDirective: 'container', leafDirective: 'leaf', textDirective: 'text' };
const FORM_SYNTAX = {
    container: (name) => t('directives.check.form.container', { name }),
    leaf: (name) => t('directives.check.form.leaf', { name }),
    text: (name) => t('directives.check.form.text', { name }),
};
const PLAN_COLUMN_TYPES = new Set(['text', 'status', 'priority', 'date', 'progress', 'percent', 'number', 'checkbox', 'select', 'link']);
const PLAN_VIEW_NEEDS = {
    timeline: (a) => a.dateCol || a.startDate || a.endDate ? '' : t('directives.check.dateColOrRange'),
    milestone: (a) => a.dateCol || a.startDate || a.endDate ? '' : 'dateCol',
    ebbinghaus: (a) => a.dateCol || a.startDate || a.endDate ? '' : 'dateCol',
    progress: (a) => a.progressCol ? '' : 'progressCol',
};

// ── Files ──

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (path.extname(entry.name).toLowerCase() === MD_EXT) out.push(full);
    }
    return out;
}

/** Files passed on the command line: only existing .md files inside the project are accepted */
function resolveArgs(args) {
    const files = [];
    const rejected = [];
    for (const arg of args) {
        const full = path.resolve(ROOT, arg);
        const inside = full === ROOT || full.startsWith(ROOT + path.sep);
        if (!inside) rejected.push(t('directives.check.outsideProject', { arg }));
        else if (path.extname(full).toLowerCase() !== MD_EXT) rejected.push(t('directives.check.notMarkdown', { arg }));
        else if (!fs.existsSync(full) || !fs.statSync(full).isFile()) rejected.push(t('directives.check.noFile', { arg }));
        else files.push(full);
    }
    return { files, rejected };
}

// ── Helpers ──

/** Strip the frontmatter but keep its line breaks, so line numbers match the original file */
function blankFrontmatter(src) {
    const m = src.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
    return m ? m[0].replace(/[^\n]/g, '') + src.slice(m[0].length) : src;
}

const slice = (src, node) => src.slice(node.position.start.offset, node.position.end.offset);

/** Raw text of a table cell, without the pipes on either side */
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
    return best ? t('directives.check.didYouMean', { name: best.name }) : '';
}

const quoteList = (items) => items.map((v) => `"${v}"`).join(listSep());

/** The first label paragraph is the content inside [square brackets], not part of the body */
const bodyChildren = (node) => (node.children || []).filter((c) => !c.data?.directiveLabel);

function findFirst(node, type) {
    let found = null;
    visit({ type: 'root', children: bodyChildren(node) }, type, (n) => {
        if (!found) found = n;
    });
    return found;
}

// ── Attributes ──

function checkValue(spec, value) {
    const v = String(value);
    switch (spec.type) {
        case 'boolean':
            return v === '' || v === 'true' || v === 'false' ? '' : t('directives.check.onlyBoolean');
        case 'enum':
            return spec.values.includes(v) ? '' : t('directives.check.onlyValues', { values: quoteList(spec.values) });
        case 'list': {
            const bad = v.split(',').map((s) => s.trim()).filter((s) => s && !spec.values.includes(s));
            return bad.length ? t('directives.check.unknownValues', { bad: quoteList(bad), values: quoteList(spec.values) }) : '';
        }
        case 'color':
            if (NAMED_COLORS.includes(v)) return '';
            return /[;<>"'{}\\]/.test(v) ? t('directives.check.badColor') : '';
        default:
            if (spec.pattern && v !== '' && !new RegExp(spec.pattern).test(v)) return t('directives.check.badFormat', { format: spec.format || spec.pattern });
            return '';
    }
}

function checkAttrs(spec, node, report) {
    const attrs = node.attributes || {};
    const known = Object.keys(spec.attrs);
    for (const [key, value] of Object.entries(attrs)) {
        const attrSpec = spec.attrs[key];
        if (!attrSpec) {
            const hint = known.length ? t('directives.check.availableAttrs', { list: known.join(listSep()) }) : t('directives.check.noAttrs');
            report('error', t('directives.check.unknownAttr', { name: spec.name, key, hint }));
            continue;
        }
        const problem = checkValue(attrSpec, value);
        if (problem) report('error', t('directives.check.attrProblem', { name: spec.name, key, value, problem }));
    }
    for (const [key, attrSpec] of Object.entries(spec.attrs)) {
        if (attrSpec.required && !attrs[key]) report('error', t('directives.check.missingAttr', { name: spec.name, key }));
    }
    for (const group of spec.oneOf || []) {
        if (!group.some((key) => attrs[key])) report('error', t('directives.check.oneOf', { name: spec.name, list: group.join(listSep()) }));
    }
}

// ── Body ──

function hasContent(node) {
    return bodyChildren(node).some((c) => c.type !== 'html' || c.value.trim());
}

function checkMarkers(marker) {
    return (node, src, report) => {
        const children = bodyChildren(node);
        const isMarker = (c) => c.type === 'paragraph' && slice(src, c).trim().startsWith(marker);
        const first = children.findIndex(isMarker);
        if (first === -1) {
            report('error', t('directives.check.noMarker', { name: node.name, marker }));
        } else if (children.slice(0, first).some((c) => c.type !== 'html' || c.value.trim())) {
            report('warn', t('directives.check.beforeMarker', { name: node.name, marker }));
        }
    };
}

const BODY_CHECKS = {
    none(node, src, report) {
        if (hasContent(node)) report('warn', t('directives.check.noBody', { name: node.name }));
    },
    list(node, src, report) {
        if (!findFirst(node, 'list')) report('error', t('directives.check.needsList', { name: node.name }));
    },
    images(node, src, report) {
        if (!findFirst(node, 'image')) report('warn', t('directives.check.noImages', { name: node.name }));
    },
    table(node, src, report, spec) {
        const table = findFirst(node, 'table');
        if (!table) {
            report('error', t('directives.check.needsTable', { name: node.name }));
            return;
        }
        const header = table.children[0]?.children.map((cell) => cellText(src, cell).toLowerCase()) || [];
        for (const col of spec.body.requiredColumns || []) {
            if (!header.includes(col)) report('error', t('directives.check.missingColumn', { name: node.name, col }));
        }
    },
    json(node, src, report) {
        // Get the raw text the same way charts.mjs does: use the code block if there is one, otherwise join all text nodes
        const code = bodyChildren(node).find((c) => c.type === 'code');
        let raw = '';
        if (code) raw = code.value || '';
        else visit({ type: 'root', children: bodyChildren(node) }, 'text', (t) => { raw += t.value; });
        raw = raw.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        try {
            JSON.parse(raw);
        } catch (e) {
            report('error', t('directives.check.badJson', { name: node.name, error: e.message }));
        }
    },
};

const NAMED_CHECKS = {
    tabs: checkMarkers('tab:'),
    folders: checkMarkers('folder:'),
    timeline(node, src, report) {
        visit({ type: 'root', children: bodyChildren(node) }, 'listItem', (item) => {
            const text = slice(src, item).replace(/^\s*[-*+]\s*/, '');
            if (text.split('|').length < 2) report('warn', t('directives.check.timelineNoPipe', { text: text.split('\n')[0].trim() }), item);
            return 'skip';
        });
    },
    okr(node, src, report) {
        if (!findFirst(node, 'heading')) report('error', t('directives.check.okrHeading'));
    },
    plan(node, src, report) {
        const attrs = node.attributes || {};
        const table = findFirst(node, 'table');
        if (table) {
            for (const cell of table.children[0]?.children || []) {
                const header = cellText(src, cell);
                if (!header.includes(':')) continue;
                const type = header.split(':')[1].trim().toLowerCase();
                if (!PLAN_COLUMN_TYPES.has(type)) report('warn', t('directives.check.planColumnType', { header, type }), cell);
            }
        }
        const views = (attrs.views || 'board,list,table,timeline,milestone,progress').split(',').map((s) => s.trim());
        for (const view of views) {
            const need = PLAN_VIEW_NEEDS[view]?.(attrs);
            if (need) report('warn', t('directives.check.planViewNeeds', { view, need }));
        }
    },
    photo(node, src, report) {
        if (!(node.attributes || {}).src && !findFirst(node, 'image')) report('error', t('directives.check.photoSrc'));
    },
};

// ── Main flow ──

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
            if (form !== 'text') report('error', t('directives.check.unknownDirective', { name: node.name, suggestion: suggest(node.name) }));
            return;
        }
        if (!spec.forms.includes(form)) {
            // A registered name written as a text directive (e.g. a:video) renders back as the original text, so it is not an error
            if (form !== 'text') {
                const allowed = spec.forms.map((f) => FORM_SYNTAX[f](spec.name)).join(t('common.or'));
                report('error', t('directives.check.wrongForm', { name: spec.name, form: FORM_SYNTAX[form](spec.name), allowed }));
            }
            return;
        }

        checkAttrs(spec, node, report);

        if (form === 'container') {
            const open = lines[node.position.start.line - 1].match(/:{3,}/)?.[0].length ?? 3;
            const close = lines[node.position.end.line - 1].match(/^[\s>]*(:{3,})\s*$/);
            if (node.position.end.line === node.position.start.line || !close || close[1].length < open) {
                report('error', t('directives.check.unclosed', { name: spec.name, colons: ':'.repeat(open) }));
            }
            BODY_CHECKS[spec.body?.kind]?.(node, src, report, spec);
            NAMED_CHECKS[spec.name]?.(node, src, report);
        }
    });

    // Lines that start with colons plus a name but were not parsed as a directive
    lines.forEach((text, i) => {
        const line = i + 1;
        if (skipLines.has(line) || directiveLines.has(line)) return;
        const spaced = text.match(/^[\s>]*(:{2,})\s+([a-zA-Z][\w-]*)/);
        if (spaced && DIRECTIVE_MAP.has(spaced[2])) {
            problems.push({ level: 'error', line, column: 1, message: t('directives.check.spaceAfterColons', { colons: spaced[1], name: spaced[2] }) });
            return;
        }
        const m = text.match(/^[\s>]*:{2,}([a-zA-Z][\w-]*)/);
        if (!m || !DIRECTIVE_MAP.has(m[1])) return;
        const reason = text.includes('{') && !text.includes('}') ? t('directives.check.attrsOneLine') : t('directives.check.blankLineBefore');
        problems.push({ level: 'error', line, column: 1, message: t('directives.check.notRecognized', { name: m[1], reason }) });
    });

    return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

const args = process.argv.slice(2);
const { files, rejected } = args.length ? resolveArgs(args) : { files: walk(CONTENT_DIR), rejected: [] };
for (const r of rejected) console.error(t('directives.check.skipped', { item: r }));

let errors = 0;
let warnings = 0;
for (const file of files) {
    for (const p of checkFile(file)) {
        if (p.level === 'error') errors++;
        else warnings++;
        console.log(`${path.relative(ROOT, file)}:${p.line}:${p.column}  ${t(p.level === 'error' ? 'directives.check.error' : 'directives.check.warning')}  ${p.message}`);
    }
}

console.log(
    `\n${t('directives.check.summary', {
        files: t('directives.check.files', { count: files.length }),
        errors: t('directives.check.errors', { count: errors }),
        warnings: t('directives.check.warnings', { count: warnings }),
    })}`
);
if (errors > 0 || rejected.length > 0) process.exit(1);
