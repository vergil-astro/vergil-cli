#!/usr/bin/env node
/**
 * Clears out the demo content, leaving a clean starting point.
 *
 * The Vergil repo is both the theme source and its own demo site, so a clone comes with
 * a dozen or so posts, two sets of sample docs, and a few albums. All of these should go when you use it yourself,
 * but deleting them by hand makes it easy to miss things: the config is also scattered with the sample site name, nav, and friend links.
 *
 * Running `vg reset` once clears it all.
 *
 * The official Vergil docs (src/content/docs/vergil-guide) are kept by default, because they are
 * the user guide; without them there is no way to look up directive syntax on the site. Add --all to delete them too.
 *
 * Add --dry to only print what would be done, without changing anything.
 *
 * What it prints follows the user's language (see i18n.mjs). The placeholder content and config it
 * writes into the site stay as they are: they are site content, not messages.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { t } from './i18n.mjs';

const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--all');
const ROOT = process.cwd();

/**
 * Where the config files written below import the theme's types from. A site on the theme
 * package (1.x) gets them from @vergil-astro/theme/types; an old template-style site (0.x)
 * carries the theme source itself, with the types in src/types.
 */
function themeTypesModule() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        if (pkg.dependencies?.['@vergil-astro/theme'] || pkg.devDependencies?.['@vergil-astro/theme']) return '@vergil-astro/theme/types';
    } catch {
        // No readable package.json: treat it as a template-style site
    }
    return '../../types';
}
const THEME_TYPES = themeTypesModule();

// Action labels padded to the same width, so the paths line up
const LABEL_WIDTH = Math.max(...['reset.delete', 'reset.rewrite', 'reset.empty'].map((k) => t(k).length));
const log = (label, msg) => console.log(`  ${t(label).padEnd(LABEL_WIDTH)} ${msg}`);

function rm(rel) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return false;
    if (!DRY) fs.rmSync(abs, { recursive: true, force: true });
    log('reset.delete', rel);
    return true;
}

function write(rel, content) {
    const abs = path.join(ROOT, rel);
    if (!DRY) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
    }
    log('reset.rewrite', rel);
}

/** Empty the content files in a directory, keeping the directory itself */
function empty(rel, exts = ['.md', '.mdx', '.json']) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    let n = 0;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const p = path.join(abs, entry.name);
        if (entry.isDirectory() || exts.some((e) => entry.name.endsWith(e))) {
            if (!DRY) fs.rmSync(p, { recursive: true, force: true });
            n++;
        }
    }
    if (n) log('reset.empty', t('reset.items', { path: rel, count: n }));
}

console.log(`\n${t(DRY ? 'reset.dryRun' : 'reset.start')}\n`);

// ── Content ──
console.log(t('reset.content'));
empty('src/content/blog');
empty('src/content/moments');
empty('src/content/thoughts');
empty('src/content/projects');
empty('src/content/series');
empty('src/content/albums');
rm('src/content/docs/kubernetes');
rm('src/content/docs/react-guide');
if (ALL) rm('src/content/docs/vergil-guide');

// contact/terms in pages are useful skeletons, so only clear the body
write(
    'src/content/pages/about.md',
    `---
title: 关于
seo:
  title: 关于本站与我
  description: 介绍你自己，以及这个站点想记录些什么。
---

这里写你的自我介绍。

删掉这段话，换成你想说的。
`
);
// The nav and footer both link to /contact; deleting it would leave a 404, so only clear the body
write(
    'src/content/pages/contact.md',
    `---
title: 留言板
seo:
  title: 留言板 - 联系我
  description: 留下你的想法、问题或建议，或者直接发邮件找我。
---

想说的话可以写在下面的评论区，也可以发邮件给我。

- **邮箱：** [you@example.com](mailto:you@example.com)

把上面的邮箱换成你自己的。评论区需要在 \`src/data/config/features.ts\` 里开启。
`
);

write(
    'src/content/pages/terms.md',
    `---
title: 使用条款
seo:
  title: 使用条款与隐私说明
  description: 本站内容的使用许可，以及访问时会收集哪些信息。
---

## 内容许可

写清楚你的文章允许别人怎么用，比如署名转载、禁止商用之类的。

## 隐私

写清楚这个站点会不会收集访客信息。如果你接了统计服务，在这里说明。

## 免责

写清楚站内内容仅代表个人观点，不构成任何建议。

以上三节都是占位，按你的实际情况改写。
`
);

// Leave an empty skeleton for the resume
write(
    'src/content/resume/index.md',
    `---
name: 你的名字
title: 你的职位
summary: 一句话介绍自己。
contacts: []
sections: []
---
`
);

// ── Assets ──
console.log(`\n${t('reset.assets')}`);
// Content images live in src/assets/img/<carrier>/<content-name>/ and are deleted along with the content cleared above.
rm('src/assets/img/blog');
rm('src/assets/img/projects');
rm('src/assets/img/albums');
rm('src/assets/img/pages/about');
rm('src/assets/img/docs/kubernetes');
rm('src/assets/img/docs/react-guide');
if (ALL) rm('src/assets/img/docs/vergil-guide');
rm('src/assets/videos');

/**
 * Settings a reset keeps from the site's current identity.ts: the UI language and the skins. They
 * are the site's choices, not sample content; rewriting them would switch an English site back to
 * Chinese and drop the skins it enabled. Values are read as plain names and written back rebuilt,
 * never copied as code; anything that doesn't look like a name falls back to the default.
 */
function keptIdentity() {
    let text = '';
    try {
        text = fs.readFileSync(path.join(ROOT, 'src/data/config/identity.ts'), 'utf8');
    } catch {
        // No identity.ts yet: use the defaults
    }
    const NAME = /^[A-Za-z0-9_-]+$/;
    const pick = (re) => {
        const value = text.match(re)?.[1];
        return value && NAME.test(value) ? value : null;
    };
    const skinsList = text.match(/^\s*skins:\s*\[([^\]\n]*)\]/m)?.[1] ?? '';
    return {
        locale: pick(/^\s*locale:\s*['"]([^'"\n]*)['"]/m) ?? 'zh-CN',
        skin: pick(/^\s*skin:\s*['"]([^'"\n]*)['"]/m) ?? 'classic',
        skins: [...skinsList.matchAll(/['"]([A-Za-z0-9_-]+)['"]/g)].map((m) => `'${m[1]}'`).join(', '),
    };
}

// ── Config ──
console.log(`\n${t('reset.config')}`);
const KEPT = keptIdentity();
const IDENTITY = `export const siteInfo = {
    title: '你的站点名',
    /** 主题界面文案的语言，也决定 <html lang> 和日期格式。可选 'zh-CN' | 'en' */
    locale: '${KEPT.locale}',
    /** 访客没选过时用哪个界面皮肤。皮肤决定圆角、按钮、投影、底纹这些形状质感，每个皮肤带着自己的几套配色，
     * 访客可以在顶栏的外观面板里自己切换。classic 是内置的，其他皮肤要先在下面的 skins 里启用 */
    skin: '${KEPT.skin}',
    /** 启用的皮肤，像 zsh 的 plugins 一样按名字写。每个皮肤要先放到站点根目录的 skins/<名字>/ 下，
     * 没放的会跳过并在构建时警告。皮肤集中在 vergil-astro/vergil-skins 仓库，用 vg skin add <名字> 安装并启用 */
    skins: [${KEPT.skins}] as string[],
    subtitle: '一句话副标题',
    description: '用一两句话说明这个站点是关于什么的，会用在 SEO 和分享卡片上。',
    image: {
        src: '/assets/site/vergil-preview.jpg',
        alt: '你的站点名'
    },
    /**
     * 备案信息，中国大陆站点用。每一项可以只写文字，也可以带跳转链接。
     * 留空则左侧栏不显示备案区块。
     *
     * 备案号与主体身份绑定，不要填别人的。示例：
     *   icp: [
     *       { text: '京ICP备00000000号-1', href: 'https://beian.miit.gov.cn/' },
     *   ],
     */
    icp: [] as Array<{ text: string; href?: string }>,
};

export const heroData = {
    title: '你好，我是 **你的名字**',
    text: '这里写一段自我介绍。支持 **Markdown**，换行用 \\\\n\\\\n。',
    titleIcon: 'Sparkles',
    textIcon: 'Zap',
    actions: [
        {
            text: '关于我',
            href: '/about'
        }
    ]
};

export const subscribe = {
    enabled: false,
    title: '订阅更新',
    text: '填入你的邮件订阅服务地址后再开启。',
    form: {
        action: '#'
    }
};

export const postsPerPage = 8;
export const projectsPerPage = 8;
`;
write('src/data/config/identity.ts', IDENTITY);

write(
    'src/data/config/links.ts',
    `/**
 * 友链、网站收藏、影单等外链数据，供 :::sites 和 :::posters 指令使用。
 * key 是分组名，在指令里用 group="分组名" 引用，例如：
 *
 *   export const links = {
 *       friends: [
 *           { title: '某人的博客', url: 'https://example.com', description: '一句话介绍' },
 *       ],
 *   };
 *
 * 字段说明见文档「站点卡片」与「海报墙」。
 */
export const links = {};

/** :::sites 没填 cover 时，先用站点的分享卡片图（og:image），没有才用这里的截图服务。可选 'mshots' | 'thumio'，mshots 对靠 JS 渲染的站点效果更好 */
export const screenshotService = 'mshots';
`
);

// The two Memo cards in the right sidebar; by default they hold the Vergil demo site's self-introduction
write(
    'src/data/config/welcome.ts',
    `import type { MemoItem } from '${THEME_TYPES}';

/**
 * 右侧栏的第一张 Memo 便签卡片。内容完全由你决定。
 * 不想要就到 features.ts 的 sidebar.components 里取消注册。
 */
export const welcome = {
    title: '这是什么',
    paragraphs: ['用一两句话介绍这个站点是做什么的。'],
    quote: '',
    actions: [{ text: '关于', href: '/about', icon: 'book-open' }],
} satisfies MemoItem;
`
);

write(
    'src/data/config/notice.ts',
    `import type { MemoItem } from '${THEME_TYPES}';

/**
 * 右侧栏的第二张 Memo 便签卡片。想加更多卡片，照这个文件新建一个，
 * 再到 features.ts 的 sidebar.components 里注册。
 */
export const notice = {
    title: '公告',
    paragraphs: ['这里可以放公告、近况，或者任何你想置顶的话。'],
    quote: '',
    actions: [],
} satisfies MemoItem;
`
);

console.log(`\n${t('reset.done')}`);
for (const step of ['reset.step1', 'reset.step2', 'reset.step3', 'reset.step4']) console.log(`  ${t(step)}`);
console.log(`  ${t('reset.step5')}\n`);
if (DRY) console.log(`${t('reset.dryNote')}\n`);
