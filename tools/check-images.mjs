#!/usr/bin/env node
/**
 * 图片体检：只读不写，不会删除或移动任何文件。
 *
 * 报告五类问题：
 *   1. 引用失效  内容里写了本地图片路径，但文件不存在（唯一会让命令失败的一类）
 *   2. 可以迁移  正文图片、banner、cover、seo.image 或图文动态的图片引用了 public/ 下的图，挪到 src/assets/img/ 用 @img/ 引用能被优化
 *   3. 内容重复  几个文件的内容完全相同
 *   4. 体积过大  单张超过 MAX_KB（改下面的常量调整）
 *   5. 暂未引用  文件名没有出现在任何源码或内容里（只提示，可能是留着以后用的）
 *
 * 用法：vg images check
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const TEXT_EXT = new Set(['.md', '.mdx', '.astro', '.ts', '.js', '.mjs', '.json', '.css', '.html', '.webmanifest']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.git']);
const CONTENT_DIR = path.join(ROOT, 'src/content');
const PUBLIC_DIR = path.join(ROOT, 'public');
// @img/ 别名，和 tsconfig.json 的 paths 保持一致
const IMG_ALIAS = '@img/';
const IMG_ALIAS_DIR = path.join(ROOT, 'src/assets/img');

/** 单张图片超过这个体积（KB）会被提示 */
const MAX_KB = 500;

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const rel = (p) => path.relative(ROOT, p);
const ext = (p) => path.extname(p).toLowerCase();

const allFiles = [...walk(path.join(ROOT, 'src')), ...walk(PUBLIC_DIR)];
const images = allFiles.filter((f) => IMAGE_EXT.has(ext(f)));
const textFiles = [...allFiles, path.join(ROOT, 'astro.config.mjs')].filter(
    (f) => TEXT_EXT.has(ext(f)) && fs.existsSync(f)
);

// ── 从内容文件里提取本地图片引用 ──
// 覆盖：Markdown 图片语法、HTML/指令的 src="..."、frontmatter 里的图片路径字段
const MD_IMAGE = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g;
const ATTR_SRC = /\b(?:src|bg|cover|banner|avatar)\s*=\s*"([^"]+)"/g;
// 内容指令里放图片的属性。sites、posters 的图片来自 links.ts 配置，不在内容里，不用处理；
// story 的镜头图片是表格里的 ![](...)，走正文图片的规则
const IMG_DIRECTIVES = {
    image: ['src'],
    photo: ['src'],
    banner: ['bg', 'avatar'],
    video: ['poster'],
    audio: ['cover'],
    yoicard: ['bg-image', 'logo'],
    button: ['icon'],
    quot: ['icon'],
    title: ['prefix', 'suffix']
};
// :name{...}、::name{...}、:::name{...}，以及带文字的 :name[文字]{...}
const DIRECTIVE = /(:{1,4})([a-z]+)(\[[^\]]*\])?\{([^}]*)\}/g;
const DIRECTIVE_ATTR = /(?<![a-z0-9-])([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g;

/** 找出指令属性里的图片路径，回调返回新值则替换（统一写成双引号） */
function mapDirectiveImages(text, onRef) {
    return text.replace(DIRECTIVE, (all, colons, name, label, body) => {
        const keys = IMG_DIRECTIVES[name];
        if (!keys) return all;
        const next = body.replace(DIRECTIVE_ATTR, (attr, key, dq, sq, bare) => {
            if (!keys.includes(key)) return attr;
            const value = onRef(dq ?? sq ?? bare);
            return value ? `${key}="${value}"` : attr;
        });
        return `${colons}${name}${label || ''}{${next}}`;
    });
}

const FM_FIELD = /^\s*-?\s*(?:image|avatar|backgroundImage):\s*(?:(['"])(.+?)\1|([^'"\s#][^\s#]*))\s*(?:#.*)?$/gm;
// 这几个字段支持 @img/，指向 public/ 时提示可以迁移
const FM_IMAGE_FIELD = /^\s*-?\s*(?:src|cover|banner):\s*(?:(['"])(.+?)\1|([^'"\s#][^\s#]*))\s*(?:#.*)?$/gm;
const JSON_STRING = /"([^"]+\.(?:png|jpe?g|webp|gif|svg|avif))"/gi;

// 代码块和行内代码里的路径只是示例，不算引用
function stripCode(text) {
    const out = [];
    let fence = null;
    for (const line of text.split('\n')) {
        // 代码块里的是写法示例；:::private 里的内容会被加密成字符串，图片没法交给 Astro，都跳过
        const m = line.match(/^\s*(`{3,}|~{3,})/) || line.match(/^\s*(:{3,})(?:private(?![a-z])|\s*$)/);
        if (fence) {
            if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
            continue;
        }
        if (m && !/^\s*:{3,}\s*$/.test(line)) {
            fence = m[1];
            continue;
        }
        out.push(line.replace(/`[^`]+`/g, ''));
    }
    return out.join('\n');
}

function isLocal(ref) {
    return ref && !/^(https?:)?\/\//i.test(ref) && !ref.startsWith('data:') && !ref.startsWith('#');
}

function hasImageExt(ref) {
    return IMAGE_EXT.has(path.extname(ref.split(/[?#]/)[0]).toLowerCase());
}

function resolveRef(ref, fromFile) {
    const clean = decodeURI(ref.split(/[?#]/)[0]);
    if (clean.startsWith(IMG_ALIAS)) return path.join(IMG_ALIAS_DIR, clean.slice(IMG_ALIAS.length));
    if (clean.startsWith('/')) return path.join(PUBLIC_DIR, clean);
    return path.resolve(path.dirname(fromFile), clean);
}

const contentFiles = walk(CONTENT_DIR).filter((f) => ['.md', '.mdx', '.json'].includes(ext(f)));
const broken = [];
const movable = [];

for (const file of contentFiles) {
    const raw = fs.readFileSync(file, 'utf8');
    const text = ext(file) === '.json' ? raw : stripCode(raw);
    const refs = new Map(); // ref -> 是否来自 Markdown 图片语法
    const add = (ref, fromMarkdown) => {
        if (!isLocal(ref) || !hasImageExt(ref)) return;
        refs.set(ref, refs.get(ref) || fromMarkdown);
    };
    if (ext(file) === '.json') {
        for (const m of text.matchAll(JSON_STRING)) add(m[1], true);
    } else {
        for (const m of text.matchAll(MD_IMAGE)) add(m[1] ?? m[2], true);
        // 支持 @img/ 的指令里的图，指向 public/ 时也提示可以迁移
        mapDirectiveImages(text, (ref) => {
            add(ref, true);
            return null;
        });
        for (const m of text.matchAll(ATTR_SRC)) add(m[1], false);
        for (const m of text.matchAll(FM_FIELD)) add(m[2] ?? m[3], false);
        for (const m of text.matchAll(FM_IMAGE_FIELD)) add(m[2] ?? m[3], true);
    }
    for (const [ref, fromMarkdown] of refs) {
        let target;
        try {
            target = resolveRef(ref, file);
        } catch {
            broken.push({ file, ref });
            continue;
        }
        if (!fs.existsSync(target)) broken.push({ file, ref });
        else if (fromMarkdown && ref.startsWith('/')) movable.push({ file, ref });
    }
}

// ── 内容重复 ──
const byHash = new Map();
for (const img of images) {
    const hash = crypto.createHash('md5').update(fs.readFileSync(img)).digest('hex');
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(img);
}
const duplicates = [...byHash.values()].filter((group) => group.length > 1);

// ── 体积过大 ──
const large = images
    .map((img) => ({ img, kb: fs.statSync(img).size / 1024 }))
    .filter((x) => x.kb > MAX_KB)
    .sort((a, b) => b.kb - a.kb);

// ── 暂未引用（按文件名匹配） ──
const corpus = textFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const unreferenced = images.filter((img) => {
    const name = path.basename(img);
    return !corpus.includes(name) && !corpus.includes(encodeURI(name));
});

// ── 输出 ──
function section(title, items, render) {
    console.log(`\n${title}（${items.length}）`);
    if (items.length === 0) {
        console.log('  无');
        return;
    }
    for (const item of items) console.log(`  ${render(item)}`);
}

console.log(`扫描了 ${images.length} 张图片、${contentFiles.length} 个内容文件`);

section('✗ 引用失效', broken, ({ file, ref }) => `${rel(file)} → ${ref}`);
section('→ 可以迁移到 src/assets/img/ 以获得优化', movable, ({ file, ref }) => `${rel(file)} → ${ref}`);
section('≡ 内容重复', duplicates, (group) => group.map(rel).join('  ==  '));
section(`▲ 体积超过 ${MAX_KB}KB`, large, ({ img, kb }) => `${rel(img)}  ${Math.round(kb)}KB`);

const unrefByDir = new Map();
for (const img of unreferenced) {
    const dir = rel(path.dirname(img));
    if (!unrefByDir.has(dir)) unrefByDir.set(dir, []);
    unrefByDir.get(dir).push(img);
}
section('○ 暂未引用（只是提示，不建议因此删除）', [...unrefByDir.entries()], ([dir, list]) => {
    const kb = Math.round(list.reduce((sum, f) => sum + fs.statSync(f).size, 0) / 1024);
    const names = list.slice(0, 3).map((f) => path.basename(f)).join(', ');
    return `${dir}/  ${list.length} 张，${kb}KB  例如 ${names}${list.length > 3 ? ' …' : ''}`;
});

if (broken.length > 0) {
    console.log(`\n有 ${broken.length} 处图片引用失效，请修复后再提交。`);
    process.exit(1);
}
console.log('\n没有失效的图片引用。');
