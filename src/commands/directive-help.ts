import { C } from '../utils/helpers.js';
import type { DirectiveInfo } from '../types.js';

/**
 * Mirrors the theme docs (src/content/docs/vergil-guide/03-基本创作/内容指令/).
 * Examples use the same syntax as vergil-writing-skills' SKILL.md, which is
 * checked against the theme's directive plugins.
 */
const DIRECTIVES: DirectiveInfo[] = [
  // 结构排版
  { name: 'grid', category: '结构排版', type: 'block', description: '多列网格，用 --- 分隔格子（--- 前后空行）', example: ':::grid{cols="3" gap="12"}\n**标题 1**\n内容 1\n\n---\n\n**标题 2**\n内容 2\n:::' },
  { name: 'tabs', category: '结构排版', type: 'block', description: '标签页，tab: 行前后空行', example: ':::tabs\ntab: 标签 1\n\n内容 1\n\ntab: 标签 2\n\n内容 2\n:::' },
  { name: 'folding', category: '结构排版', type: 'block', description: '折叠面板', example: ':::folding{title="查看完整配置"}\n较长的内容\n:::' },
  { name: 'folders', category: '结构排版', type: 'block', description: '多级折叠，folder: 行前后空行', example: ':::folders\nfolder: 第一章 基础\n\n内容 1\n\nfolder: 第二章 组件\n\n内容 2\n:::' },
  { name: 'timeline', category: '结构排版', type: 'block', description: '时间线：时间 | 标题 | 描述', example: ':::timeline\n- 2024-01 | 项目启动 | 确定技术栈\n- 2024-03 | 发布 v1 | 功能上线\n:::' },
  { name: 'banner', category: '结构排版', type: 'block', description: '横幅头图', example: ':::banner{title="山与湖" subtitle="记录每一次出发" bg="https://..."}\n:::' },
  { name: 'poetry', category: '结构排版', type: 'block', description: '诗词排版', example: ':::poetry{title="静夜思" author="李白" date="唐"}\n床前明月光，\n疑是地上霜。\n:::' },
  { name: 'paper', category: '结构排版', type: 'block', description: '信纸，<!-- paragraph --> 分段', example: ':::paper{title="信" author="作者" date="日期"}\n正文\n<!-- paragraph -->\n下一段\n:::' },
  { name: 'reel', category: '结构排版', type: 'block', description: '竖排卷轴', example: ':::reel{title="兰亭集序" author="王羲之" date="东晋"}\n竖排文字\n:::' },

  // 内容展示
  { name: 'callout', category: '内容展示', type: 'block', description: '提示框：type 为 info / tip / warn / danger', example: ':::callout{type="tip" title="小技巧"}\n提示内容\n:::' },
  { name: 'note', category: '内容展示', type: 'block', description: '高亮块', example: ':::note{color="blue" title="关于主题"}\n内容\n:::' },
  { name: 'quot', category: '内容展示', type: 'block', description: '引用卡片', example: ':::quot{icon="lightbulb"}\n引用内容\n:::' },
  { name: 'title', category: '内容展示', type: 'block', description: '装饰标题：style 为 quote / badge', example: ':::title{style="quote"}\n读万卷书，行万里路\n:::' },
  { name: 'blockquote', category: '内容展示', type: 'block', description: '带引号的段落', example: ':::blockquote\n多段引用内容\n:::' },
  { name: 'code', category: '内容展示', type: 'code', description: '代码块（不是指令）：窗口样式，shell 代码里 $ 开头的行是命令', example: '```ts title="vite.config.ts" highlight="2"\nimport { defineConfig } from \'vite\'\nimport tailwindcss from \'@tailwindcss/vite\'\n```\n\n```bash title="安装"\n$ pnpm install\nDone in 3.2s\n```' },
  { name: 'panel', category: '内容展示', type: 'block', description: '多段代码并列', example: ':::panel\n```js title="文件 A" right="说明 A"\ncode...\n```\n\n```js title="文件 B" right="说明 B"\ncode...\n```\n:::' },
  { name: 'copy', category: '内容展示', type: 'block', description: '一键复制', example: ':::copy{label="安装依赖"}\npnpm add remark-directive\n:::' },
  { name: 'private', category: '内容展示', type: 'block', description: '密码加密内容', example: ':::private{password="vergil" hint="主题名"}\n加密内容\n:::' },

  // 媒体嵌入
  { name: 'image', category: '媒体嵌入', type: 'leaf', description: '增强图片，alt 显示为说明', example: '::image{src="https://..." alt="图片说明" download="true" ratio="1/1" width="300px"}' },
  { name: 'gallery', category: '媒体嵌入', type: 'block', description: '图片画廊', example: ':::gallery{layout="grid"}\n![alt](url)\n![alt](url)\n:::' },
  { name: 'photo', category: '媒体嵌入', type: 'leaf', description: '摄影框，带相机参数', example: '::photo{src="https://..." brand="Fujifilm" focal="23mm" aperture="f/8" shutter="1/250s" iso="ISO 160"}' },
  { name: 'video', category: '媒体嵌入', type: 'block', description: '视频：本地 / bilibili / youtube', example: ':::video{bilibili="BV1GJ411x7h7"}\n:::' },
  { name: 'audio', category: '媒体嵌入', type: 'block', description: '音频：本地 / 网易云 / 语音', example: ':::audio{netease="25706282" title="晴天" artist="歌手" mode="card"}\n:::' },

  // 卡片与链接
  { name: 'ghcard', category: '卡片与链接', type: 'block', description: 'GitHub 仓库或用户卡片', example: ':::ghcard{type="repo" repo="owner/repo"}\n:::' },
  { name: 'yoicard', category: '卡片与链接', type: 'block', description: '数字名片', example: ':::yoicard{name="你的名字" role="写作者 · 摄影师"}\n\n一句话简介\n\n<!-- contact -->\n\n**example.com**\nhello@example.com\n:::' },
  { name: 'sites', category: '卡片与链接', type: 'block', description: '网站卡片，数据在 src/data/config/links.ts', example: ':::sites{group="friends"}\n:::' },
  { name: 'posters', category: '卡片与链接', type: 'block', description: '海报墙', example: ':::posters{group="movies" ratio="square"}\n:::' },
  { name: 'hashtag', category: '卡片与链接', type: 'inline', description: '标签链接', example: ':hashtag[Astro]{href="/tags/astro"}' },
  { name: 'button', category: '卡片与链接', type: 'inline', description: '按钮链接', example: ':button[查看文档]{href="/" color="accent" icon="lucide:search"}' },

  // 文字与交互
  { name: 'mark', category: '文字与交互', type: 'inline', description: '高亮文字，默认黄色', example: ':mark[关键内容]\n:mark[特别注意]{color="red"}' },
  { name: 'u', category: '文字与交互', type: 'inline', description: '下划线', example: ':u[下划线]{color="blue"}' },
  { name: 'emp', category: '文字与交互', type: 'inline', description: '着重号', example: ':emp[需要强调的内容]' },
  { name: 'wavy', category: '文字与交互', type: 'inline', description: '波浪线', example: ':wavy[拼写错误提示]{color="red"}' },
  { name: 'del', category: '文字与交互', type: 'inline', description: '删除线', example: ':del[¥199]' },
  { name: 'sup', category: '文字与交互', type: 'inline', description: '上标', example: 'E = mc:sup[2]' },
  { name: 'sub', category: '文字与交互', type: 'inline', description: '下标', example: 'H:sub[2]O' },
  { name: 'kbd', category: '文字与交互', type: 'inline', description: '键盘按键', example: ':kbd[Ctrl] + :kbd[C]' },
  { name: 'blur', category: '文字与交互', type: 'inline', description: '模糊显示，点击揭示', example: ':blur[点击这里查看隐藏内容]' },
  { name: 'psw', category: '文字与交互', type: 'inline', description: '密码遮罩', example: ':psw[MySecretDB_2024]' },
  { name: 'checkbox', category: '文字与交互', type: 'inline', description: '复选框', example: ':checkbox[未勾选]\n:checkbox[已勾选]{checked="true" color="green"}' },
  { name: 'radio', category: '文字与交互', type: 'inline', description: '单选框', example: ':radio[选项 A]{checked="true" color="orange"}' },
  { name: 'step-brackets', category: '文字与交互', type: 'inline', description: '步骤编号', example: ':step-brackets[01]{title="克隆仓库"}' },
  { name: 'emoji', category: '文字与交互', type: 'inline', description: '表情包', example: '终于跑通了 :emoji[1f389]{source="twemoji"}' },
  { name: 'ann', category: '文字与交互', type: 'inline', description: '手绘标注', example: ':ann[空山]{note="雨后的安静" direction="top-right" color="green"}新雨后' },

  // 图表可视化
  { name: 'mermaid', category: '图表可视化', type: 'block', description: 'Mermaid 流程图、时序图等', example: ':::mermaid\nflowchart LR\n    A[请求] --> B{有缓存?}\n    B -->|是| C[返回缓存]\n    B -->|否| D[查数据库]\n:::' },
  { name: 'echart', category: '图表可视化', type: 'block', description: 'ECharts 图表，内容是 JSON 配置', example: ':::echart{height="300px"}\n{\n  "xAxis": { "type": "category", "data": ["一月", "二月", "三月"] },\n  "yAxis": { "type": "value" },\n  "series": [{ "type": "bar", "data": [120, 200, 150] }]\n}\n:::' },

  // 时间规划
  { name: 'deadline', category: '时间规划', type: 'block', description: '翻牌倒计时', example: ':::deadline{date="2026-12-31T23:59:59" title="报名截止" description="剩余时间"}\n:::' },
  { name: 'calendar', category: '时间规划', type: 'block', description: '月历，支持农历和节假日', example: ':::calendar{month="2026-05"}\n| date | type | content | color | link |\n| ---- | ---- | ------- | ----- | ---- |\n| 05-01 | 假期 | 短途旅行 | red | |\n:::' },
  { name: 'okr', category: '时间规划', type: 'block', description: 'OKR 目标与关键结果', example: ':::okr{title="Q2 目标" period="2026 Q2"}\n## O1: 扩大订阅\n\n| Key Result | Target | Current | Status |\n|------------|--------|---------|--------|\n| 订阅人数 | 1000 | 640 | ontrack |\n:::' },
  { name: 'plan', category: '时间规划', type: 'block', description: '多视图任务看板，属性必须写在一行', example: ':::plan{title="发布计划" views="board,table,timeline" dateCol="截止" statusCol="状态" titleCol="任务"}\n| 任务:text | 状态:status | 截止:date | 进度:progress |\n|-----------|-------------|-----------|---------------|\n| 写规格 | done | 2026-01-10 | 100% |\n| 开发 | doing | 2026-02-01 | 60% |\n:::' },

  // 可视化叙事
  { name: 'story', category: '可视化叙事', type: 'block', description: '分镜故事板', example: ':::story\n| shot | scale | duration | image | desc | dialogue |\n|------|-------|----------|-------|------|----------|\n| 1 | 特写 | 3s | https://... | 她看了眼手机 | 「怎么了？」 |\n:::' },
  { name: 'mind', category: '可视化叙事', type: 'block', description: '思维导图，嵌套列表', example: ':::mind\n- 主题设计\n  - 视觉系统\n    - 配色\n    - 字体\n  - 内容指令\n:::' },
];

const CATEGORY_ORDER = ['结构排版', '内容展示', '媒体嵌入', '卡片与链接', '文字与交互', '图表可视化', '时间规划', '可视化叙事'];

/** Names from older vg versions */
const ALIASES: Record<string, string> = { terminal: 'code' };

export async function directiveHelpCommand(topic?: string): Promise<void> {
  if (!topic || topic === 'directives') {
    const count = DIRECTIVES.filter(d => d.type !== 'code').length;
    console.log(C.accent(`\nVergil Directives — ${count} 个内容指令\n`));
    console.log(C.muted('Use `vg help <directive>` for syntax. Math needs no directive: write $...$ and set katex: true in frontmatter.\n'));

    for (const category of CATEGORY_ORDER) {
      const items = DIRECTIVES.filter(d => d.category === category);
      console.log(C.subtitle(`${category}:`));
      items.forEach(d => {
        console.log(`  ${C.accent(d.name.padEnd(16))} ${C.text(d.description)}`);
      });
      console.log();
    }
    return;
  }

  const name = ALIASES[topic] || topic;
  const directive = DIRECTIVES.find(d => d.name === name);
  if (!directive) {
    console.log(C.error(`✗ Directive not found: ${topic}`));
    console.log(C.muted('Run `vg help directives` to see all'));
    return;
  }

  console.log(C.accent(`\n${directive.name.toUpperCase()}\n`));
  console.log(`${C.text('Category:')} ${directive.category}`);
  console.log(`${C.text('Type:')} ${C.accent(directive.type)}`);
  console.log(`${C.text('Desc:')} ${directive.description}\n`);
  console.log(C.subtitle('Example:'));
  console.log(C.muted(directive.example));
  console.log();
}
