import { C } from '../utils/helpers.js';
import type { DirectiveInfo } from '../types.js';

const DIRECTIVES: DirectiveInfo[] = [
  { name: 'callout', type: 'block', description: '提示框: info/tip/warning/danger', example: ':::callout{variant="tip"}\n内容\n:::' },
  { name: 'panel', type: 'block', description: '代码对比面板', example: ':::panel\n```js title="A"\n// code\n```\n:::' },
  { name: 'tabs', type: 'block', description: '标签页切换', example: '::::tabs\ntab: 标签1\n\n内容\n::::' },
  { name: 'folding', type: 'block', description: '折叠面板', example: ':::folding{title="展开"}\n内容\n:::' },
  { name: 'timeline', type: 'block', description: '时间线', example: ':::timeline\n- 2024-01 | 事件 | 描述\n:::' },
  { name: 'grid', type: 'block', description: '多列网格', example: ':::grid{cols="3"}\n**A**\n内容\n---\n**B**\n内容\n:::' },
  { name: 'banner', type: 'block', description: '横幅头图', example: ':::banner{title="标题" bg="url"}\n:::' },
  { name: 'gallery', type: 'block', description: '图片画廊', example: ':::gallery\n![alt](url)\n:::' },
  { name: 'photo', type: 'block', description: '摄影框', example: '::photo{src="url" watermark="true"}' },
  { name: 'terminal', type: 'code', description: '终端块', example: '```bash terminal\n$ command\n```' },
  { name: 'copy', type: 'block', description: '一键复制', example: ':::copy\ncontent\n:::' },
  { name: 'ghcard', type: 'block', description: 'GitHub 卡片', example: ':::ghcard{type="repo" repo="owner/repo"}\n:::' },
  { name: 'mark', type: 'inline', description: '高亮文字', example: ':mark[关键词]' },
  { name: 'button', type: 'inline', description: '按钮链接', example: ':button[点击]{href="/"}' },
  { name: 'checkbox', type: 'inline', description: '复选框', example: ':checkbox[选项]{checked="true"}' },
  { name: 'blur', type: 'inline', description: '模糊显示(点击揭示)', example: ':blur[隐藏内容]' },
  { name: 'note', type: 'block', description: '高亮块', example: ':::note\n内容\n:::' },
  { name: 'quot', type: 'block', description: '引用卡片', example: ':::quot\n引用内容\n:::' },
  { name: 'blockquote', type: 'block', description: '段落引号', example: ':::blockquote\n多段引用\n:::' },
  { name: 'poetry', type: 'block', description: '诗词排版', example: ':::poetry{title="静夜思"}\n床前明月光\n:::' },
  { name: 'paper', type: 'block', description: '信纸', example: ':::paper\n正文\n:::' },
  { name: 'reel', type: 'block', description: '卷轴', example: ':::reel\n竖排文字\n:::' },
  { name: 'audio', type: 'block', description: '音频播放器', example: ':::audio{src="..." title="歌曲"}' },
  { name: 'video', type: 'block', description: '视频嵌入', example: ':::video{bilibili="BVxxx"}' },
  { name: 'sites', type: 'block', description: '网站链接卡片', example: ':::sites{group="friends"}\n:::' },
  { name: 'posters', type: 'block', description: '海报墙', example: ':::posters{group="movies"}\n:::' },
  { name: 'title', type: 'block', description: '标题装饰', example: ':::title{type="quote"}\n标题\n:::' },
  { name: 'private', type: 'block', description: '密码加密', example: ':::private{password="secret"}\n加密内容\n:::' },
  { name: 'u', type: 'inline', description: '下划线', example: ':u[文字]{color="blue"}' },
  { name: 'emp', type: 'inline', description: '着重号', example: ':emp[强调]' },
  { name: 'del', type: 'inline', description: '删除线', example: ':del[已废弃]' },
  { name: 'kbd', type: 'inline', description: '键盘按键', example: ':kbd[Ctrl] + :kbd[C]' },
  { name: 'hashtag', type: 'inline', description: '标签链接', example: ':hashtag[tag]{href="/tags/tag"}' },
  { name: 'step-brackets', type: 'inline', description: '步骤标记', example: ':step-brackets[01]{title="步骤"}' },
];

export async function directiveHelpCommand(topic?: string): Promise<void> {
  if (!topic || topic === 'directives') {
    console.log(C.accent('\nVergil Directives — 指令大全\n'));
    console.log(C.muted('Use `vg help <directive>` for detailed syntax\n'));

    const grouped = DIRECTIVES.reduce<Record<string, DirectiveInfo[]>>((acc, d) => {
      acc[d.type] = acc[d.type] || [];
      acc[d.type].push(d);
      return acc;
    }, {});

    for (const [type, items] of Object.entries(grouped)) {
      console.log(C.subtitle(type.toUpperCase() + ' DIRECTIVES:'));
      items.forEach(d => {
        console.log(`  ${C.accent(d.name.padEnd(18))} ${C.text(d.description)}`);
      });
      console.log();
    }
    return;
  }

  const directive = DIRECTIVES.find(d => d.name === topic);
  if (!directive) {
    console.log(C.error(`✗ Directive not found: ${topic}`));
    console.log(C.muted('Run `vg help directives` to see all'));
    return;
  }

  console.log(C.accent(`\n${directive.name.toUpperCase()}\n`));
  console.log(`${C.text('Type:')} ${C.accent(directive.type)}`);
  console.log(`${C.text('Desc:')} ${directive.description}\n`);
  console.log(C.subtitle('Example:'));
  console.log(C.muted(directive.example));
  console.log();
}
