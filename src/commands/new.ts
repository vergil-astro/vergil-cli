import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { formatDate, ensureDir, getProjectRoot, getNextIndex, slugify } from '../utils/file.js';
import { generateFrontmatter } from '../utils/frontmatter.js';
import { C } from '../utils/helpers.js';
import type { NewOptions, ContentType } from '../types.js';

const CONTENT_DIRS: Record<ContentType, string> = {
  post: 'blog',
  page: 'pages',
  project: 'projects',
  album: 'albums',
  thought: 'thoughts',
  moment: 'moments',
  doc: 'docs',
};

const CONTENT_TEMPLATES: Record<string, string> = {
  post: '## 引言\n\n在这里写下你的文章开头...\n\n## 正文\n\n## 总结\n',
  page: '## 关于\n\n在这里写下页面内容...\n',
  project: '## 项目简介\n\n在这里介绍你的项目...\n\n## 技术栈\n\n:::grid{cols="3" gap="12"}\n**前端**\nAstro + Tailwind CSS\n\n---\n\n**后端**\n\n---\n\n**部署**\nVercel / Netlify\n:::\n\n## 功能亮点\n\n- 核心功能一\n- 核心功能二\n- 核心功能三\n\n## 相关链接\n',
  album: '## 关于本期\n\n在这里写下相册的描述...\n\n## 拍摄理念\n\n:::callout{variant="tip" title="拍摄理念"}\n这组作品采用低饱和度、高对比度的处理方式，强调光影层次与几何构图。\n:::\n',
  doc: '## 概述\n\n在这里写下文档概述...\n\n## 内容\n\n在这里写下文档正文...\n',
};

export async function newCommand(type: string, title: string, options: NewOptions): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project. Run `vg init` first.'));
    return;
  }

  const contentType = type as ContentType;
  if (!CONTENT_DIRS[contentType]) {
    console.log(C.error(`✗ Unknown content type: ${type}`));
    console.log(C.muted('Available: post, page, project, album, thought, moment, doc'));
    return;
  }

  const dirName = CONTENT_DIRS[contentType];
  const contentDir = join(root, 'src', 'content', dirName);
  ensureDir(contentDir);

  const date = formatDate();
  const slug = slugify(title);
  let filename: string;
  let filepath: string;

  if (contentType === 'doc') {
    const subPath = options.path || slug;
    const docDir = join(contentDir, subPath);
    ensureDir(docDir);
    filepath = join(docDir, 'index.md');
    filename = `${subPath}/index.md`;
  } else if (contentType === 'moment') {
    const index = getNextIndex(contentDir);
    filename = options.path || `${date}--moment-${index}.json`;
    filepath = join(contentDir, filename);
  } else {
    const index = getNextIndex(contentDir);
    filename = options.path || `${date}--${slug}-${index}.md`;
    filepath = join(contentDir, filename);
  }

  if (existsSync(filepath)) {
    console.log(C.error(`✗ File already exists: ${filepath}`));
    return;
  }

  const tags = options.tags ? options.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  if (contentType === 'moment') {
    const data = {
      date: new Date().toISOString(),
      content: title,
      tags,
      images: [],
    };
    writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');

    const relativePath = filepath.replace(root + '/', '');
    console.log(C.success(`✓ moment created: ${C.accent(relativePath)}`));
    return;
  }

  let meta: Record<string, unknown> = { title };

  if (contentType === 'post') {
    meta = {
      title,
      publishDate: date,
      draft: options.draft || false,
      tags,
      ...(options.series && { series: options.series }),
      ...(options.cover && { banner: options.cover }),
    };
  } else if (contentType === 'page') {
    meta = { title };
  } else if (contentType === 'project') {
    meta = {
      title,
      publishDate: date,
      ...(options.description && { description: options.description }),
      ...(options.website && { website: options.website }),
      ...(options.repo && { repo: options.repo }),
    };
  } else if (contentType === 'album') {
    meta = {
      title,
      date,
      draft: options.draft || false,
      tags,
      theme: options.theme || 'golden',
      ...(options.cover && { cover: options.cover }),
    };
  } else if (contentType === 'thought') {
    meta = {
      date: new Date().toISOString(),
      tags,
    };
  } else if (contentType === 'doc') {
    meta = {
      title,
      draft: options.draft || false,
      tags,
    };
  }

  const fm = generateFrontmatter(meta);
  let body: string;

  if (contentType === 'thought') {
    // Thought body is the content text (title argument)
    body = `\n${title}\n`;
  } else {
    const template = CONTENT_TEMPLATES[contentType] || '';
    body = template ? `\n${template}` : '\n';
  }

  writeFileSync(filepath, `${fm}${body}`);

  const relativePath = filepath.replace(root + '/', '');
  console.log(C.success(`✓ ${contentType} created: ${C.accent(relativePath)}`));

  if (options.draft) {
    console.log(C.muted('  Status: draft'));
  }
}
