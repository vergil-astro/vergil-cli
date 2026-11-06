#!/usr/bin/env node
/**
 * 规整图片：把内容里引用的本地图片挪到 src/assets/img/<载体>/<内容名>/，
 * 引用改成 @img/ 别名。规则见文档「图片与静态资源」。
 *
 * 处理范围：
 *   - 载体：src/content/ 下的 blog、projects、pages、docs、albums、series、thoughts、moments
 *   - 正文里的 Markdown 图片 ![](...)，代码块里的示例不动
 *   - 内容指令 image、photo 的 src，banner 的 bg、avatar
 *   - 图文动态 JSON 里的图片路径（images、linkCard.image 等）
 *   - frontmatter 里的 src、cover、banner（seo.image.src、文章和文档的 banner、知识库、相册和专栏的 cover、相册的 images[].src）
 *
 * 不处理：
 *   - 内容指令里的 src（指令只接受字符串路径）
 *   - 外链、已经是 @img/ 的引用
 *
 * 安全措施：
 *   - 不删除任何图片。没被引用的图原地不动
 *   - 已经在 src/assets/img/ 里的图：只把写法统一成 @img/，不挪文件
 *   - src/assets/img/ 之外的图被多条内容引用：移给第一条，其余各复制一份
 *   - 图片还被代码、配置或字符串字段引用，或者是 public/assets/site、defaults 下的站点文件：只复制不移动
 *   - 目标位置已有同名但内容不同的文件：自动改名为 xxx-1.png
 *   - 引用的文件不存在：跳过，在最后列出来
 *
 * 执行完会自动跑一次 images:check，只报告结果，不会因为失效引用而失败：
 * 站点的 build 会先做这一步整理，一处失效引用不应该挡住整个部署。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

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

/** 内容文件属于哪个载体、图片该放进哪个目录 */
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

// ── 1. 找出所有要处理的引用 ──
// 正文图片：路径可以用 <...> 包起来，里面允许空格
const MD_IMAGE = /(!\[[^\]]*\]\(\s*)(?:<([^>]+)>|([^)\s]+))((?:\s+"[^"]*")?\s*\))/g;
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

// frontmatter：值可以加引号（允许空格），后面可以跟 # 注释
const FM_FIELD = /^(\s*-?\s*(?:src|cover|banner):\s*)(?:(['"])(.+?)\2|([^'"\s#][^\s#]*))(\s*(?:#.*)?)$/;

/** 改写后的值：YAML 里一律加引号，正文里有空格时用 <> 包起来 */
const yamlQuote = (v) => (v.includes("'") ? `"${v}"` : `'${v}'`);
const mdPath = (v) => (/\s/.test(v) ? `<${v}>` : v);

const contentFiles = CARRIERS.flatMap((c) => walk(path.join(CONTENT_DIR, c))).filter((f) => /\.(md|mdx)$/.test(f) || (f.endsWith('.json') && f.startsWith(path.join(CONTENT_DIR, 'moments'))));

const JSON_STRING = /"([^"]+\.(?:png|jpe?g|webp|gif|svg|avif))"/gi;

/** 扫描一个内容文件，回调每个可处理的引用，回调返回新值则替换 */
function mapRefs(text, onRef, file) {
    // 图文动态 JSON：只替换对应的字符串，不重新序列化，保留原来的格式
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

const refsBySource = new Map(); // 源文件 → [{ file, targetDir }]
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

// ── 2. 决定每张图挪到哪 ──
function uniqueTarget(dir, name, source) {
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    for (let n = 0; ; n++) {
        const candidate = path.join(dir, n === 0 ? name : `${stem}-${n}${ext}`);
        if (!fs.existsSync(candidate)) return { target: candidate, reuse: false };
        if (candidate === source || md5(candidate) === md5(source)) return { target: candidate, reuse: true };
    }
}

const newRef = new Map(); // `${file}\0${source}` → @img/ 路径
const operations = []; // { kind: 'move' | 'copy', from, to }
const plannedTargets = new Set();

for (const [source, refs] of refsBySource) {
    const targetByDir = new Map(); // 同一个目标目录只放一份，比如同一知识库里的几篇文档引用同一张图
    for (const { file, targetDir } of refs) {
        let target = targetByDir.get(targetDir);
        if (target) {
            // 已经排好了，直接复用
        } else if (source.startsWith(IMG_DIR + path.sep)) {
            // 已经在 src/assets/img/ 里的图，放在哪由用户决定，只把写法统一成 @img/，不挪文件。
            // 这样 images:expand 展开再改回，结果不变；公共素材目录也能被多处直接引用。
            target = source;
        } else {
            const picked = uniqueTarget(targetDir, path.basename(source), source);
            target = picked.target;
            // 同一次运行里前面已经排到这个位置的，也算占用
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

// ── 3. 改写内容里的引用 ──
const rewritten = new Map(); // file → 新文本
for (const file of contentFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const next = mapRefs(text, (ref) => {
        const source = resolveRef(ref, file);
        return newRef.get(`${file}\0${source}`) || null;
    }, file);
    if (next !== text) rewritten.set(file, next);
}

// ── 4. 能移动的就移动：源文件不再被任何地方引用时，第一份复制改成移动 ──
const corpusFiles = [...walk(path.join(ROOT, 'src')), ...walk(PUBLIC_DIR), path.join(ROOT, 'astro.config.mjs')].filter(
    (f) => TEXT_EXT.has(path.extname(f).toLowerCase()) && fs.existsSync(f)
);
// public/assets/site/ 和 defaults/ 是站点本身的文件，被内容引用了也只复制，不能挪走
const SITE_DIRS = ['site', 'defaults'].map((d) => path.join(PUBLIC_DIR, 'assets', d) + path.sep);
const isSiteFile = (file) => SITE_DIRS.some((d) => file.startsWith(d));

for (const source of refsBySource.keys()) {
    if (isSiteFile(source) || stillReferencedElsewhere(source)) continue;
    const first = operations.find((op) => op.from === source && op.kind === 'copy');
    if (first) first.kind = 'move';
}

/** 去掉代码块和行内代码，里面的路径只是写法示例 */
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
        out.push(line.replace(/`[^`]*`/g, ''));
    }
    return out.join('\n');
}

/** 改写之后，源文件的原路径是否还出现在任何文件里（代码、配置、字符串字段等） */
function stillReferencedElsewhere(source) {
    const relToPublic = source.startsWith(PUBLIC_DIR + path.sep) ? '/' + path.relative(PUBLIC_DIR, source).split(path.sep).join('/') : null;
    const name = path.basename(source);
    for (const f of corpusFiles) {
        const raw = rewritten.get(f) ?? fs.readFileSync(f, 'utf8');
        const text = /\.(md|mdx)$/.test(f) ? stripCode(raw) : raw;
        if (!text.includes(name)) continue;
        if (relToPublic && text.includes(relToPublic)) return true;
        // 相对路径引用：看这个文件里是否还有指向源文件的相对路径
        for (const m of text.matchAll(new RegExp(`[("'\\s]([^("'\\s]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'))) {
            const ref = m[1];
            if (ref.startsWith(IMG_ALIAS) || /^(https?:)?\/\//.test(ref)) continue;
            try {
                if (resolveRef(ref, f) === source) return true;
            } catch {
                /* 忽略无法解析的片段 */
            }
        }
    }
    return false;
}

// ── 5. 执行 ──
// 先复制，最后再移动，避免同一张图既要复制又要移动时源文件先没了
for (const op of [...operations.filter((o) => o.kind === 'copy'), ...operations.filter((o) => o.kind === 'move')]) {
    fs.mkdirSync(path.dirname(op.to), { recursive: true });
    if (op.kind === 'move') fs.renameSync(op.from, op.to);
    else fs.copyFileSync(op.from, op.to);
}
for (const [file, text] of rewritten) fs.writeFileSync(file, text, 'utf8');

// ── 6. 报告 ──
const moved = operations.filter((o) => o.kind === 'move');
const copied = operations.filter((o) => o.kind === 'copy');
console.log(`\n移动 ${moved.length} 张，复制 ${copied.length} 张，改写 ${rewritten.size} 个内容文件`);
for (const op of moved) console.log(`  移动  ${rel(op.from)} → ${rel(op.to)}`);
for (const op of copied) console.log(`  复制  ${rel(op.from)} → ${rel(op.to)}`);
for (const file of rewritten.keys()) console.log(`  改写  ${rel(file)}`);
if (missing.length) {
    console.log(`\n跳过 ${missing.length} 处引用，图片文件不存在：`);
    for (const { file, ref } of missing) console.log(`  ${rel(file)} → ${ref}`);
}
if (operations.length === 0 && rewritten.size === 0) console.log('  所有内容图片都已经符合规则，没有需要整理的。');

console.log('\n检查整理结果：');
const check = spawnSync(process.execPath, [new URL('./check-images.mjs', import.meta.url).pathname], { stdio: 'inherit' });
if (check.status) console.log('（有失效引用，不影响继续执行。需要让它变成失败时用 vg images check）');
