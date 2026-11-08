#!/usr/bin/env node
/**
 * Image health check: read-only; it never deletes or moves any file.
 *
 * Reports five kinds of problems:
 *   1. Broken references  content points to a local image path, but the file does not exist (the only kind that fails the command)
 *   2. Movable            body images, banner, cover, seo.image, or image moment images reference images under public/; moving them to src/assets/img/ and referencing them with @img/ lets them be optimized
 *   3. Duplicates         several files have exactly the same content
 *   4. Too large          a single image exceeds MAX_KB (change the constant below to adjust)
 *   5. Unreferenced       the file name does not appear in any source or content (just a hint; it may be kept for later use)
 *
 * Usage: vg images check
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { t } from './i18n.mjs';

const ROOT = process.cwd();
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const TEXT_EXT = new Set(['.md', '.mdx', '.astro', '.ts', '.js', '.mjs', '.json', '.css', '.html', '.webmanifest']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.git']);
const CONTENT_DIR = path.join(ROOT, 'src/content');
const PUBLIC_DIR = path.join(ROOT, 'public');
// The @img/ alias, kept in sync with paths in tsconfig.json
const IMG_ALIAS = '@img/';
const IMG_ALIAS_DIR = path.join(ROOT, 'src/assets/img');

/** Images larger than this size (KB) are flagged */
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

// ── Extract local image references from content files ──
// Covers: Markdown image syntax, src="..." in HTML/directives, and image path fields in frontmatter
const MD_IMAGE = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g;
const ATTR_SRC = /\b(?:src|bg|cover|banner|avatar)\s*=\s*"([^"]+)"/g;
// Content directive attributes that hold images. Images for sites and posters come from the links.ts config, not from content, so they need no handling;
// story shot images are ![](...) inside a table and follow the body image rules
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
// :name{...}, ::name{...}, :::name{...}, and :name[text]{...} with a label
const DIRECTIVE = /(:{1,4})([a-z]+)(\[[^\]]*\])?\{([^}]*)\}/g;
const DIRECTIVE_ATTR = /(?<![a-z0-9-])([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g;

/** Find image paths in directive attributes; if the callback returns a new value, replace it (always written with double quotes) */
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
// These fields support @img/; when they point to public/, suggest moving the image
const FM_IMAGE_FIELD = /^\s*-?\s*(?:src|cover|banner):\s*(?:(['"])(.+?)\1|([^'"\s#][^\s#]*))\s*(?:#.*)?$/gm;
const JSON_STRING = /"([^"]+\.(?:png|jpe?g|webp|gif|svg|avif))"/gi;

// Paths in code blocks and inline code are only examples, not references
function stripCode(text) {
    const out = [];
    let fence = null;
    for (const line of text.split('\n')) {
        // Code blocks hold syntax examples, and content inside :::private is encrypted into a string so its images cannot be handed to Astro; skip both
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
    const refs = new Map(); // ref -> whether it came from Markdown image syntax
    const add = (ref, fromMarkdown) => {
        if (!isLocal(ref) || !hasImageExt(ref)) return;
        refs.set(ref, refs.get(ref) || fromMarkdown);
    };
    if (ext(file) === '.json') {
        for (const m of text.matchAll(JSON_STRING)) add(m[1], true);
    } else {
        for (const m of text.matchAll(MD_IMAGE)) add(m[1] ?? m[2], true);
        // Images in directives that support @img/ also get the move suggestion when they point to public/
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

// ── Duplicate content ──
const byHash = new Map();
for (const img of images) {
    const hash = crypto.createHash('md5').update(fs.readFileSync(img)).digest('hex');
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(img);
}
const duplicates = [...byHash.values()].filter((group) => group.length > 1);

// ── Too large ──
const large = images
    .map((img) => ({ img, kb: fs.statSync(img).size / 1024 }))
    .filter((x) => x.kb > MAX_KB)
    .sort((a, b) => b.kb - a.kb);

// ── Unreferenced (matched by file name) ──
const corpus = textFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const unreferenced = images.filter((img) => {
    const name = path.basename(img);
    return !corpus.includes(name) && !corpus.includes(encodeURI(name));
});

// ── Output ──
function section(title, items, render) {
    console.log(`\n${t('images.check.section', { title, count: items.length })}`);
    if (items.length === 0) {
        console.log(`  ${t('images.check.none')}`);
        return;
    }
    for (const item of items) console.log(`  ${render(item)}`);
}

console.log(t('images.check.scanned', { images: t('images.count', { count: images.length }), files: t('images.contentFiles', { count: contentFiles.length }) }));

section(t('images.check.broken'), broken, ({ file, ref }) => `${rel(file)} → ${ref}`);
section(t('images.check.movable'), movable, ({ file, ref }) => `${rel(file)} → ${ref}`);
section(t('images.check.duplicates'), duplicates, (group) => group.map(rel).join('  ==  '));
section(t('images.check.large', { kb: MAX_KB }), large, ({ img, kb }) => `${rel(img)}  ${Math.round(kb)}KB`);

const unrefByDir = new Map();
for (const img of unreferenced) {
    const dir = rel(path.dirname(img));
    if (!unrefByDir.has(dir)) unrefByDir.set(dir, []);
    unrefByDir.get(dir).push(img);
}
section(t('images.check.unreferenced'), [...unrefByDir.entries()], ([dir, list]) => {
    const kb = Math.round(list.reduce((sum, f) => sum + fs.statSync(f).size, 0) / 1024);
    const names = list.slice(0, 3).map((f) => path.basename(f)).join(', ');
    return `${t('images.check.unrefGroup', { dir, count: list.length, kb, names })}${list.length > 3 ? ' …' : ''}`;
});

if (broken.length > 0) {
    console.log(`\n${t('images.check.failed', { count: broken.length })}`);
    process.exit(1);
}
console.log(`\n${t('images.check.ok')}`);
