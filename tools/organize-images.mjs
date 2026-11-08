#!/usr/bin/env node
/**
 * Organize images: move local images referenced in content to src/assets/img/<carrier>/<content-name>/
 * and rewrite the references to the @img/ alias. See the docs page on images and static assets for the rules.
 *
 * Scope:
 *   - carriers: blog, projects, pages, docs, albums, series, thoughts, and moments under src/content/
 *   - Markdown images ![](...) in the body; examples in code blocks are left alone
 *   - src of the image and photo content directives, bg and avatar of banner
 *   - image paths in image moment JSON (images, linkCard.image, etc.)
 *   - src, cover, and banner in frontmatter (seo.image.src, banner of posts and docs, cover of knowledge bases, albums, and series, images[].src of albums)
 *
 * Not handled:
 *   - src inside content directives (directives only accept string paths)
 *   - external links and references that already use @img/
 *
 * Safeguards:
 *   - Never deletes an image. Unreferenced images stay where they are
 *   - Images already in src/assets/img/: only the reference is normalized to @img/; the file is not moved
 *   - An image outside src/assets/img/ referenced by several content entries: moved for the first one, copied once for each of the rest
 *   - An image also referenced by code, config, or string fields, or a site file under public/assets/site or defaults: copied, never moved
 *   - A file with the same name but different content already at the target: automatically renamed to xxx-1.png
 *   - A referenced file that does not exist: skipped and listed at the end
 *
 * When done it automatically runs images:check once, which only reports results and does not fail on broken references:
 * the site build runs this organize step first, and one broken reference should not block the whole deployment.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { t } from './i18n.mjs';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'src/content');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMG_DIR = path.join(ROOT, 'src/assets/img');
const IMG_ALIAS = '@img/';
const CARRIERS = ['blog', 'projects', 'pages', 'docs', 'albums', 'series', 'thoughts', 'moments'];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const TEXT_EXT = new Set(['.md', '.mdx', '.astro', '.ts', '.js', '.mjs', '.json', '.css', '.html', '.webmanifest']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.git']);

const rel = (p) => path.relative(ROOT, p);

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

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

/** Which carrier a content file belongs to, and which directory its images should go in */
function targetDirOf(file) {
    const parts = path.relative(CONTENT_DIR, file).split(path.sep);
    const carrier = parts[0];
    if (carrier === 'docs') return path.join(IMG_DIR, 'docs', parts[1]);
    const base = path.basename(file).replace(/\.(md|mdx|json)$/, '');
    const name = base === 'index' && parts.length > 2 ? parts[parts.length - 2] : base;
    return path.join(IMG_DIR, carrier, name);
}

function isCandidate(ref) {
    if (!ref || ref.startsWith(IMG_ALIAS)) return false;
    if (/^(https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) return false;
    return IMAGE_EXT.has(path.extname(ref.split(/[?#]/)[0]).toLowerCase());
}

function resolveRef(ref, fromFile) {
    const clean = decodeURI(ref.split(/[?#]/)[0]);
    if (clean.startsWith('/')) return path.join(PUBLIC_DIR, clean);
    return path.resolve(path.dirname(fromFile), clean);
}

// ── 1. Find all references to process ──
// Body images: the path may be wrapped in <...>, which allows spaces inside
const MD_IMAGE = /(!\[[^\]]*\]\(\s*)(?:<([^>]+)>|([^)\s]+))((?:\s+"[^"]*")?\s*\))/g;
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

// frontmatter: the value may be quoted (allowing spaces) and may be followed by a # comment
const FM_FIELD = /^(\s*-?\s*(?:src|cover|banner):\s*)(?:(['"])(.+?)\2|([^'"\s#][^\s#]*))(\s*(?:#.*)?)$/;

/** Rewritten values: always quoted in YAML, and wrapped in <> in the body when they contain spaces */
const yamlQuote = (v) => (v.includes("'") ? `"${v}"` : `'${v}'`);
const mdPath = (v) => (/\s/.test(v) ? `<${v}>` : v);

const contentFiles = CARRIERS.flatMap((c) => walk(path.join(CONTENT_DIR, c))).filter((f) => /\.(md|mdx)$/.test(f) || (f.endsWith('.json') && f.startsWith(path.join(CONTENT_DIR, 'moments'))));

const JSON_STRING = /"([^"]+\.(?:png|jpe?g|webp|gif|svg|avif))"/gi;

/** Scan a content file and call back for each reference that can be processed; if the callback returns a new value, replace it */
function mapRefs(text, onRef, file) {
    // Image moment JSON: only replace the matching strings, without re-serializing, to keep the original formatting
    if (file && file.endsWith('.json')) {
        return text.replace(JSON_STRING, (all, ref) => {
            if (!isCandidate(ref)) return all;
            const next = onRef(ref);
            return next ? `"${next}"` : all;
        });
    }
    const lines = text.split('\n');
    let inFrontmatter = lines[0] === '---';
    let fence = null;
    for (let i = inFrontmatter ? 1 : 0; i < lines.length; i++) {
        const line = lines[i];
        if (inFrontmatter) {
            if (line === '---') {
                inFrontmatter = false;
                continue;
            }
            const m = line.match(FM_FIELD);
            const value = m && (m[3] ?? m[4]);
            if (value && isCandidate(value)) {
                const next = onRef(value);
                if (next) lines[i] = `${m[1]}${yamlQuote(next)}${m[5]}`;
            }
            continue;
        }
        // Code blocks hold syntax examples, and content inside :::private is encrypted into a string so its images cannot be handed to Astro; skip both
        const f = line.match(/^\s*(`{3,}|~{3,})/) || line.match(/^\s*(:{3,})(?:private(?![a-z])|\s*$)/);
        if (fence) {
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
            continue;
        }
        if (f && !/^\s*:{3,}\s*$/.test(line)) {
            fence = f[1];
            continue;
        }
        // Inline code `...` holds syntax examples, so only the parts outside code are processed
        lines[i] = line
            .split(/(`[^`]*`)/)
            .map((part) =>
                part.startsWith('`')
                    ? part
                    : mapDirectiveImages(
                          part.replace(MD_IMAGE, (all, head, angled, plain, tail) => {
                              const ref = angled ?? plain;
                              if (!isCandidate(ref)) return all;
                              const next = onRef(ref);
                              return next ? `${head}${mdPath(next)}${tail}` : all;
                          }),
                          (ref) => (isCandidate(ref) ? onRef(ref) : null)
                      )
            )
            .join('');
    }
    return lines.join('\n');
}

const refsBySource = new Map(); // source file → [{ file, targetDir }]
const missing = [];
for (const file of contentFiles) {
    mapRefs(fs.readFileSync(file, 'utf8'), (ref) => {
        const source = resolveRef(ref, file);
        if (!fs.existsSync(source)) {
            missing.push({ file, ref });
            return null;
        }
        if (!refsBySource.has(source)) refsBySource.set(source, []);
        const list = refsBySource.get(source);
        if (!list.some((r) => r.file === file)) list.push({ file, targetDir: targetDirOf(file) });
        return null;
    }, file);
}

// ── 2. Decide where each image goes ──
function uniqueTarget(dir, name, source) {
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    for (let n = 0; ; n++) {
        const candidate = path.join(dir, n === 0 ? name : `${stem}-${n}${ext}`);
        if (!fs.existsSync(candidate)) return { target: candidate, reuse: false };
        if (candidate === source || md5(candidate) === md5(source)) return { target: candidate, reuse: true };
    }
}

const newRef = new Map(); // `${file}\0${source}` → @img/ path
const operations = []; // { kind: 'move' | 'copy', from, to }
const plannedTargets = new Set();

for (const [source, refs] of refsBySource) {
    const targetByDir = new Map(); // Only one copy per target directory, e.g. when several docs in the same knowledge base reference the same image
    for (const { file, targetDir } of refs) {
        let target = targetByDir.get(targetDir);
        if (target) {
            // Already planned, reuse it
        } else if (source.startsWith(IMG_DIR + path.sep)) {
            // For images already in src/assets/img/, where they live is the user's call: only normalize the reference to @img/, do not move the file.
            // That way expanding with images:expand and converting back leaves the result unchanged, and shared asset directories can be referenced directly from many places.
            target = source;
        } else {
            const picked = uniqueTarget(targetDir, path.basename(source), source);
            target = picked.target;
            // A target already planned earlier in the same run also counts as taken
            while (!picked.reuse && plannedTargets.has(target)) {
                const ext = path.extname(target);
                target = target.replace(new RegExp(`(-(\\d+))?\\${ext}$`), (m, g, d) => `-${(Number(d) || 0) + 1}${ext}`);
            }
            if (!picked.reuse) {
                plannedTargets.add(target);
                operations.push({ kind: 'copy', from: source, to: target });
            }
        }
        targetByDir.set(targetDir, target);
        newRef.set(`${file}\0${source}`, IMG_ALIAS + path.relative(IMG_DIR, target).split(path.sep).join('/'));
    }
}

// ── 3. Rewrite the references in content ──
const rewritten = new Map(); // file → new text
for (const file of contentFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const next = mapRefs(text, (ref) => {
        const source = resolveRef(ref, file);
        return newRef.get(`${file}\0${source}`) || null;
    }, file);
    if (next !== text) rewritten.set(file, next);
}

// ── 4. Move where possible: when the source file is no longer referenced anywhere, turn its first copy into a move ──
const corpusFiles = [...walk(path.join(ROOT, 'src')), ...walk(PUBLIC_DIR), path.join(ROOT, 'astro.config.mjs')].filter(
    (f) => TEXT_EXT.has(path.extname(f).toLowerCase()) && fs.existsSync(f)
);
// public/assets/site/ and defaults/ hold the site's own files: even when content references them, they are only copied, never moved
const SITE_DIRS = ['site', 'defaults'].map((d) => path.join(PUBLIC_DIR, 'assets', d) + path.sep);
const isSiteFile = (file) => SITE_DIRS.some((d) => file.startsWith(d));

for (const source of refsBySource.keys()) {
    if (isSiteFile(source) || stillReferencedElsewhere(source)) continue;
    const first = operations.find((op) => op.from === source && op.kind === 'copy');
    if (first) first.kind = 'move';
}

/** Strip code blocks and inline code; paths inside them are only syntax examples */
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
        out.push(line.replace(/`[^`]*`/g, ''));
    }
    return out.join('\n');
}

/** After rewriting, whether the source file's original path still appears in any file (code, config, string fields, etc.) */
function stillReferencedElsewhere(source) {
    const relToPublic = source.startsWith(PUBLIC_DIR + path.sep) ? '/' + path.relative(PUBLIC_DIR, source).split(path.sep).join('/') : null;
    const name = path.basename(source);
    for (const f of corpusFiles) {
        const raw = rewritten.get(f) ?? fs.readFileSync(f, 'utf8');
        const text = /\.(md|mdx)$/.test(f) ? stripCode(raw) : raw;
        if (!text.includes(name)) continue;
        if (relToPublic && text.includes(relToPublic)) return true;
        // Relative path references: check whether this file still has a relative path pointing to the source file
        for (const m of text.matchAll(new RegExp(`[("'\\s]([^("'\\s]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'))) {
            const ref = m[1];
            if (ref.startsWith(IMG_ALIAS) || /^(https?:)?\/\//.test(ref)) continue;
            try {
                if (resolveRef(ref, f) === source) return true;
            } catch {
                /* Ignore fragments that cannot be resolved */
            }
        }
    }
    return false;
}

// ── 5. Execute ──
// Copy first and move last, so an image that is both copied and moved does not lose its source file too early
for (const op of [...operations.filter((o) => o.kind === 'copy'), ...operations.filter((o) => o.kind === 'move')]) {
    fs.mkdirSync(path.dirname(op.to), { recursive: true });
    if (op.kind === 'move') fs.renameSync(op.from, op.to);
    else fs.copyFileSync(op.from, op.to);
}
for (const [file, text] of rewritten) fs.writeFileSync(file, text, 'utf8');

// ── 6. Report ──
const moved = operations.filter((o) => o.kind === 'move');
const copied = operations.filter((o) => o.kind === 'copy');
console.log(
    `\n${t('images.organize.summary', {
        moved: t('images.count', { count: moved.length }),
        copied: t('images.count', { count: copied.length }),
        files: t('images.contentFiles', { count: rewritten.size }),
    })}`
);
// Labels padded to the same width, so the paths line up
const [movedLabel, copiedLabel, rewroteLabel] = (() => {
    const labels = [t('images.organize.moved'), t('images.organize.copied'), t('images.organize.rewrote')];
    const width = Math.max(...labels.map((l) => l.length));
    return labels.map((l) => l.padEnd(width));
})();
for (const op of moved) console.log(`  ${movedLabel}  ${rel(op.from)} → ${rel(op.to)}`);
for (const op of copied) console.log(`  ${copiedLabel}  ${rel(op.from)} → ${rel(op.to)}`);
for (const file of rewritten.keys()) console.log(`  ${rewroteLabel}  ${rel(file)}`);
if (missing.length) {
    console.log(`\n${t('images.organize.missing', { count: missing.length })}`);
    for (const { file, ref } of missing) console.log(`  ${rel(file)} → ${ref}`);
}
if (operations.length === 0 && rewritten.size === 0) console.log(`  ${t('images.organize.nothing')}`);

console.log(`\n${t('images.organize.checking')}`);
// check-images inherits this environment, VG_LANG included, so it speaks the same language
const check = spawnSync(process.execPath, [new URL('./check-images.mjs', import.meta.url).pathname], { stdio: 'inherit' });
if (check.status) console.log(t('images.organize.brokenNote'));
