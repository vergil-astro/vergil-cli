#!/usr/bin/env node
/**
 * Expand image references: rewrite @img/xxx in content into relative paths pointing to src/assets/img/xxx,
 * so they are easy to preview and edit in Typora or VS Code. Image files are left alone.
 *
 * Astro resolves the expanded relative paths just as well, so pnpm dev and pnpm build both work;
 * before a build, vg images organize runs first and turns them back into @img/.
 *
 * Scope: .md/.mdx under blog, projects, pages, docs, albums, series, and thoughts;
 * ![](...) in the body, src of the image/photo content directives and bg/avatar of banner, and src, cover, and banner in frontmatter.
 * Syntax examples in code blocks are left alone.
 *
 * Not handled: image moments (JSON, which editors cannot preview, and whose images only support @img/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.mjs';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'src/content');
const IMG_DIR = path.join(ROOT, 'src/assets/img');
const IMG_ALIAS = '@img/';
const CARRIERS = ['blog', 'projects', 'pages', 'docs', 'albums', 'series', 'thoughts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.git']);

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(md|mdx)$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** @img/xxx → a relative path from this file to src/assets/img/xxx */
function toRelative(ref, file) {
    const target = path.join(IMG_DIR, ref.slice(IMG_ALIAS.length));
    let rel = path.relative(path.dirname(file), target).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
}

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

// Body images: the path may be wrapped in <...>, which allows spaces inside
const MD_IMAGE = /(!\[[^\]]*\]\(\s*)(?:<(@img\/[^>]+)>|(@img\/[^)\s]+))((?:\s+"[^"]*")?\s*\))/g;
// frontmatter: the value may be quoted (allowing spaces) and may be followed by a # comment
const FM_FIELD = /^(\s*-?\s*(?:src|cover|banner):\s*)(?:(['"])(@img\/.+?)\2|(@img\/[^\s#]*))(\s*(?:#.*)?)$/;

function expand(text, file) {
    const lines = text.split('\n');
    let inFrontmatter = lines[0] === '---';
    let fence = null;
    let count = 0;
    for (let i = inFrontmatter ? 1 : 0; i < lines.length; i++) {
        const line = lines[i];
        if (inFrontmatter) {
            if (line === '---') {
                inFrontmatter = false;
                continue;
            }
            const m = line.match(FM_FIELD);
            if (m) {
                const rel = toRelative(m[3] ?? m[4], file);
                const quote = m[2] || (/\s/.test(rel) ? "'" : '');
                lines[i] = `${m[1]}${quote}${rel}${quote}${m[5]}`;
                count++;
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
                              count++;
                              const rel = toRelative(angled ?? plain, file);
                              return `${head}${angled !== undefined || /\s/.test(rel) ? `<${rel}>` : rel}${tail}`;
                          }),
                          (ref) => {
                              if (!ref.startsWith(IMG_ALIAS)) return null;
                              count++;
                              return toRelative(ref, file);
                          }
                      )
            )
            .join('');
    }
    return { text: lines.join('\n'), count };
}

let files = 0;
let refs = 0;
for (const file of CARRIERS.flatMap((c) => walk(path.join(CONTENT_DIR, c)))) {
    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes(IMG_ALIAS)) continue;
    const { text, count } = expand(original, file);
    if (text === original) continue;
    fs.writeFileSync(file, text, 'utf8');
    files++;
    refs += count;
    console.log(`  ${t('images.expand.file', { path: path.relative(ROOT, file), count })}`);
}
console.log(
    files
        ? `\n${t('images.expand.done', { files: t('images.expand.files', { count: files }), refs: t('images.expand.refs', { count: refs }) })}`
        : t('images.expand.nothing')
);
