#!/usr/bin/env node
/**
 * 展开图片引用：把内容里的 @img/xxx 改成指向 src/assets/img/xxx 的相对路径，
 * 方便在 Typora、VS Code 里预览和修改。图片文件不动。
 *
 * 展开后的相对路径 Astro 同样能解析，pnpm dev、pnpm build 都正常；
 * 构建前会先运行 vg images organize，把它们改回 @img/。
 *
 * 处理范围：blog、projects、pages、docs、albums、series、thoughts 下的 .md/.mdx，
 * 正文里的 ![](...)、内容指令 image/photo 的 src 和 banner 的 bg/avatar、frontmatter 里的 src、cover、banner。
 * 代码块里的写法示例不动。
 *
 * 不处理：图文动态（JSON，编辑器预览不了，它的图片只支持 @img/）。
 */
import fs from 'node:fs';
import path from 'node:path';

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

/** @img/xxx → 从这个文件出发指向 src/assets/img/xxx 的相对路径 */
function toRelative(ref, file) {
    const target = path.join(IMG_DIR, ref.slice(IMG_ALIAS.length));
    let rel = path.relative(path.dirname(file), target).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
}

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

// 正文图片：路径可以用 <...> 包起来，里面允许空格
const MD_IMAGE = /(!\[[^\]]*\]\(\s*)(?:<(@img\/[^>]+)>|(@img\/[^)\s]+))((?:\s+"[^"]*")?\s*\))/g;
// frontmatter：值可以加引号（允许空格），后面可以跟 # 注释
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
        // 代码块里的是写法示例；:::private 里的内容会被加密成字符串，图片没法交给 Astro，都跳过
        const f = line.match(/^\s*(`{3,}|~{3,})/) || line.match(/^\s*(:{3,})(?:private(?![a-z])|\s*$)/);
        if (fence) {
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
            continue;
        }
        if (f && !/^\s*:{3,}\s*$/.test(line)) {
            fence = f[1];
            continue;
        }
        // 行内代码 `...` 里的是写法示例，只处理代码之外的部分
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
    console.log(`  展开  ${path.relative(ROOT, file)}（${count} 处）`);
}
console.log(files ? `\n展开了 ${files} 个文件、${refs} 处引用。改完运行 vg images organize 或构建，会改回 @img/。` : '没有需要展开的 @img/ 引用。');
