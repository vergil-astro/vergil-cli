import { writeFileSync, existsSync, readFileSync } from 'fs';
import matter from 'gray-matter';
import { basename, dirname, isAbsolute, join } from 'path';
import { formatDate, ensureDir, getProjectRoot, getNextIndex, slugify, listMarkdownFiles } from '../utils/file.js';
import { generateFrontmatter } from '../utils/frontmatter.js';
import { loadSeriesDefs, findSeriesDef } from '../utils/series.js';
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

const ALBUM_THEMES = ['golden', 'seasons'];

const CONTENT_TEMPLATES: Record<string, string> = {
  post: '## 引言\n\n在这里写下你的文章开头...\n\n## 正文\n\n## 总结\n',
  page: '## 关于\n\n在这里写下页面内容...\n',
  project: '## 项目简介\n\n在这里介绍你的项目...\n\n## 技术栈\n\n:::grid{cols="3" gap="12"}\n**前端**\nAstro + Tailwind CSS\n\n---\n\n**后端**\n\n---\n\n**部署**\nVercel / Netlify\n:::\n\n## 功能亮点\n\n- 核心功能一\n- 核心功能二\n- 核心功能三\n\n## 相关链接\n',
  album: '## 关于本期\n\n在这里写下相册的描述...\n\n## 拍摄理念\n\n:::callout{type="tip" title="拍摄理念"}\n这组作品采用低饱和度、高对比度的处理方式，强调光影层次与几何构图。\n:::\n',
  doc: '## 概述\n\n在这里写下文档概述...\n\n## 内容\n\n在这里写下文档正文...\n',
};

/**
 * Split a user-supplied relative path into segments, rejecting anything that
 * could escape the content directory.
 */
function safeSegments(path: string): string[] | null {
  if (isAbsolute(path) || path.includes('\\')) return null;
  const segments = path.split('/').map(s => s.trim()).filter(Boolean);
  if (segments.some(s => s === '..' || s === '.')) return null;
  return segments;
}

/** `owner/repo` or a github.com URL → `owner/repo` */
function toRepoSlug(input: string): string | null {
  const slug = input.trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) ? slug : null;
}

function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/["\s]/.test(input);
  } catch {
    return false;
  }
}

/**
 * Project links go into the body: the theme's projects schema has no
 * website/repo fields, so frontmatter would silently drop them.
 */
function projectLinks(options: NewOptions): string | null {
  const lines: string[] = [];
  if (options.website) {
    if (!isHttpUrl(options.website)) {
      console.log(C.error(`✗ --website must be an http(s) URL: ${options.website}`));
      return null;
    }
    lines.push(`:button[访问网站]{href="${options.website}" icon="lucide:globe"}\n`);
  }
  if (options.repo) {
    const repo = toRepoSlug(options.repo);
    if (!repo) {
      console.log(C.error(`✗ --repo must be owner/repo or a github.com URL: ${options.repo}`));
      return null;
    }
    lines.push(`:::ghcard{type="repo" repo="${repo}"}\n:::\n`);
  }
  return lines.join('\n');
}

/**
 * Folder paths a book registers in _meta.md `dirs`, walked the same way as the
 * theme's flattenDirs. Docs in folders missing from this list stay out of the sidebar.
 */
function registeredDirs(metaPath: string): string[] {
  const result: string[] = [];
  const walk = (items: unknown, parent: string): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item === 'string') {
        result.push(parent ? `${parent}/${item}` : item);
      } else if (item && typeof item === 'object') {
        for (const [key, children] of Object.entries(item)) {
          const path = parent ? `${parent}/${key}` : key;
          result.push(path);
          walk(children, path);
        }
      }
    }
  };
  try {
    walk(matter(readFileSync(metaPath, 'utf8')).data.dirs, '');
  } catch {
    // unreadable _meta.md: treat as no dirs
  }
  return result.map(p => p.toLowerCase());
}

/**
 * Docs live in books: src/content/docs/<book>/ with a _meta.md.
 * `--path` is the folder the new doc goes in (`<book>` or `<book>/<chapter>`);
 * without it the title starts a new book and becomes its first doc.
 *
 * No index.md at the book root: its entry id would equal the book id, and the
 * theme shows the first doc (or _meta.md's `homepage`) at /docs/<book>/.
 */
function createDoc(root: string, contentDir: string, title: string, slug: string, options: NewOptions): void {
  const segments = safeSegments(options.path || '');
  if (!segments) {
    console.log(C.error(`✗ Invalid --path: ${options.path}`));
    return;
  }

  const isNewBook = segments.length === 0;
  const bookId = isNewBook ? slug : segments[0];
  const targetDir = join(contentDir, ...(isNewBook ? [slug] : segments));
  const filepath = join(targetDir, `${slug}.md`);

  if (existsSync(filepath)) {
    console.log(C.error(`✗ File already exists: ${filepath.replace(root + '/', '')}`));
    return;
  }

  ensureDir(targetDir);

  const metaPath = join(contentDir, bookId, '_meta.md');
  if (!existsSync(metaPath)) {
    writeFileSync(metaPath, `${generateFrontmatter({ title: isNewBook ? title : bookId })}\n`);
    console.log(C.success(`✓ book created: ${C.accent(metaPath.replace(root + '/', ''))}`));
  }

  const tags = options.tags ? options.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  // order: 1 keeps a new book's first doc on top, which also makes it the book's front page
  const fm = generateFrontmatter({ title, ...(isNewBook && { order: 1 }), draft: options.draft || false, tags });
  writeFileSync(filepath, `${fm}\n\n${CONTENT_TEMPLATES.doc}`);

  console.log(C.success(`✓ doc created: ${C.accent(filepath.replace(root + '/', ''))}`));
  if (options.draft) {
    console.log(C.muted('  Status: draft'));
  }

  const chapter = segments.slice(1).join('/');
  if (chapter && !registeredDirs(metaPath).includes(chapter.toLowerCase())) {
    console.log(C.warning(`⚠ "${chapter}" is not listed in dirs of ${metaPath.replace(root + '/', '')}`));
    console.log(C.muted('  The theme only shows docs from folders listed there; add it to make this doc appear in the sidebar.'));
  }
}

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

  // For thoughts and moments the argument is the content itself, so an
  // unusable slug just falls back to the type name.
  if (!slug && contentType !== 'thought' && contentType !== 'moment') {
    console.log(C.error(`✗ Can't derive a filename from title: ${title}`));
    return;
  }

  if (contentType === 'doc') {
    createDoc(root, contentDir, title, slug, options);
    return;
  }

  if (contentType === 'album' && options.theme && !ALBUM_THEMES.includes(options.theme)) {
    console.log(C.error(`✗ Unknown album theme: ${options.theme} (use ${ALBUM_THEMES.join(' or ')})`));
    return;
  }

  let targetDir = contentDir;
  let series = options.series;

  // A series that claims a folder with `dir` collects posts from that folder,
  // so the post goes there and doesn't need its own `series` field.
  if (contentType === 'post' && options.series) {
    const def = findSeriesDef(loadSeriesDefs(root), options.series);
    if (def?.dir) {
      targetDir = join(contentDir, def.dir);
      series = undefined;
    }
  }

  let filename: string;
  if (options.path) {
    const segments = safeSegments(options.path);
    if (!segments || segments.length === 0) {
      console.log(C.error(`✗ Invalid --path: ${options.path}`));
      return;
    }
    filename = segments.join('/');
  } else if (contentType === 'moment') {
    filename = `${date}--moment-${getNextIndex(contentDir)}.json`;
  } else if (contentType === 'thought') {
    filename = `${date}--${slug || 'thought'}-${getNextIndex(contentDir)}.md`;
  } else {
    // The filename is the URL: /blog/<name>/, /projects/<name>/, /albums/<name>/, /<name>/
    filename = `${slug}.md`;
  }

  const filepath = join(targetDir, filename);

  if (existsSync(filepath)) {
    console.log(C.error(`✗ File already exists: ${filepath.replace(root + '/', '')}`));
    return;
  }

  // Folders under blog/ don't count toward the URL, so names must be unique
  // across all of them — the theme fails the build otherwise.
  if (contentType === 'post') {
    const name = basename(filename).replace(/\.mdx?$/, '').toLowerCase();
    const clash = listMarkdownFiles(contentDir)
      .find(f => basename(f).replace(/\.mdx?$/, '').toLowerCase() === name);
    if (clash) {
      console.log(C.error(`✗ Another post already uses /blog/${name}/: ${clash.replace(root + '/', '')}`));
      return;
    }
  }

  ensureDir(dirname(filepath));

  const tags = options.tags ? options.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  if (contentType === 'moment') {
    const data = {
      date: new Date().toISOString(),
      content: title,
      tags,
      images: [],
    };
    writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');

    console.log(C.success(`✓ moment created: ${C.accent(filepath.replace(root + '/', ''))}`));
    return;
  }

  let meta: Record<string, unknown> = { title };
  let body = CONTENT_TEMPLATES[contentType] || '';

  if (contentType === 'post') {
    meta = {
      title,
      publishDate: date,
      draft: options.draft || false,
      tags,
      ...(series && { series }),
      ...(options.cover && { banner: options.cover }),
    };
  } else if (contentType === 'project') {
    const links = projectLinks(options);
    if (links === null) return;
    meta = {
      title,
      publishDate: date,
      ...(options.description && { description: options.description }),
    };
    body += links ? `\n${links}` : '';
  } else if (contentType === 'album') {
    meta = {
      title,
      date,
      tags,
      theme: options.theme || 'golden',
      ...(options.cover && { cover: options.cover }),
    };
  } else if (contentType === 'thought') {
    meta = {
      date: new Date().toISOString(),
      tags,
    };
    // Thought body is the content text (title argument)
    body = `${title}\n`;
  }

  writeFileSync(filepath, `${generateFrontmatter(meta)}\n\n${body}`);

  console.log(C.success(`✓ ${contentType} created: ${C.accent(filepath.replace(root + '/', ''))}`));

  if (options.draft && contentType === 'post') {
    console.log(C.muted('  Status: draft'));
  }
}
