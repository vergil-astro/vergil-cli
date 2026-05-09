import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import type { ListOptions } from '../types.js';
import { C, link } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { readFrontmatter } from '../utils/frontmatter.js';

// Singular type → directory under src/content/
const TYPE_DIRS: Record<string, string> = {
  post: 'blog',
  page: 'pages',
  project: 'projects',
  album: 'albums',
  thought: 'thoughts',
  moment: 'moments',
};

const TYPE_ORDER: string[] = ['post', 'page', 'project', 'album', 'thought', 'moment'];

// Accept singular ("post"), plural ("posts"), and the raw dir name ("blog").
const TYPE_ALIASES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const t of TYPE_ORDER) {
    map[t] = t;
    map[t + 's'] = t;
    map[TYPE_DIRS[t]] = t;
  }
  return map;
})();

function normalizeType(input: string): string | null {
  return TYPE_ALIASES[input.toLowerCase()] || null;
}

interface FileEntry {
  name: string;
  path: string;
  relpath: string;
  mtime: Date;
  meta?: Record<string, unknown>;
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function listFilesRecursive(dir: string, baseDir: string): FileEntry[] {
  const results: FileEntry[] = [];
  if (!exists(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, baseDir));
      continue;
    }

    if (
      !entry.name.endsWith('.md') &&
      !entry.name.endsWith('.mdx') &&
      !entry.name.endsWith('.json')
    ) continue;

    let meta: Record<string, unknown> | undefined;
    try {
      if (entry.name.endsWith('.json')) {
        const json = JSON.parse(readFileSync(fullPath, 'utf8'));
        meta = {
          title: json.content || json.title || entry.name,
          date: json.date,
          tags: json.tags,
        };
      } else {
        meta = readFrontmatter(fullPath) || undefined;
      }
    } catch { /* ignore */ }

    results.push({
      name: entry.name,
      path: fullPath,
      relpath: relative(baseDir, fullPath),
      mtime: statSync(fullPath).mtime,
      meta,
    });
  }

  return results;
}

function loadType(root: string, type: string): FileEntry[] {
  const dir = join(root, 'src', 'content', TYPE_DIRS[type]);
  return listFilesRecursive(dir, dir)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

function printSummary(root: string, draftsOnly: boolean): void {
  const rows = TYPE_ORDER
    .map(type => {
      const files = loadType(root, type);
      const drafts = files.filter(f => f.meta?.draft === true).length;
      const visible = draftsOnly ? drafts : files.length;
      return { type, total: files.length, drafts, visible };
    })
    .filter(r => r.visible > 0);

  if (rows.length === 0) {
    console.log(C.muted(draftsOnly ? 'No drafts found.' : 'No content found.'));
    return;
  }

  console.log(C.accent(draftsOnly ? '\nDrafts\n' : '\nContent\n'));
  console.log(C.dim('─'.repeat(60)));

  const typeWidth = Math.max(...rows.map(r => r.type.length), 8);
  for (const r of rows) {
    const draftLabel = !draftsOnly && r.drafts > 0
      ? C.warning(`  (${r.drafts} draft${r.drafts > 1 ? 's' : ''})`)
      : '';
    console.log(
      `  ${C.accent(r.type.padEnd(typeWidth))}  ` +
      `${C.text(String(r.visible).padStart(3))}${draftLabel}`
    );
  }

  const totalVisible = rows.reduce((s, r) => s + r.visible, 0);
  const totalDrafts = rows.reduce((s, r) => s + r.drafts, 0);
  const draftSuffix = !draftsOnly && totalDrafts > 0
    ? `, ${totalDrafts} draft${totalDrafts > 1 ? 's' : ''}`
    : '';

  console.log(C.muted(`\nTotal: ${totalVisible} item${totalVisible !== 1 ? 's' : ''}${draftSuffix}`));
  console.log(C.muted(draftsOnly
    ? 'Use `vg list <type> -d` to focus on one type.'
    : 'Use `vg list <type>` to view items.'));
}

function formatDate(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  // ISO-ish strings: keep first 10 chars
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return s;
}

function printDetail(root: string, type: string, draftsOnly: boolean): void {
  const files = loadType(root, type)
    .filter(f => draftsOnly ? f.meta?.draft === true : true);

  if (files.length === 0) {
    console.log(C.muted(draftsOnly
      ? `No drafts in ${type}.`
      : `No ${type} content found.`));
    return;
  }

  console.log(C.accent(`\n${type.toUpperCase()} (${files.length})`));
  console.log(C.dim('─'.repeat(60)));

  files.forEach(f => {
    const title = String(f.meta?.title || f.name);
    const date = formatDate(f.meta?.date ?? f.meta?.publishDate);
    const draftTag = f.meta?.draft === true ? C.warning(' [draft]') : '';
    const tags = Array.isArray(f.meta?.tags) && f.meta?.tags.length > 0
      ? C.muted(` #${f.meta.tags[0]}`)
      : '';
    const pathLabel = f.relpath.includes('/') ? C.muted(` (${f.relpath})`) : '';

    console.log(`  ${C.accent('▸')} ${link(C.text(title), f.path)}${draftTag}${tags}${pathLabel}`);
    if (!pathLabel && date) {
      console.log(`    ${C.muted(date)} ${C.muted(f.name)}`);
    }
  });
}

export async function listCommand(type: string | undefined, options: ListOptions): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  if (!type) {
    return printSummary(root, !!options.drafts);
  }

  const normalized = normalizeType(type);
  if (!normalized) {
    console.log(C.error(`✗ Unknown type: ${type}`));
    console.log(C.muted('Available: post, page, project, album, thought, moment'));
    console.log(C.muted('Use `vg docs` for documentation books.'));
    return;
  }

  return printDetail(root, normalized, !!options.drafts);
}
