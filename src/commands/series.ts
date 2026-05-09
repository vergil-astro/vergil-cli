import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { C, link } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';

function listBlogFiles(dir: string): string[] {
  const results: string[] = [];
  if (!dirExists(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listBlogFiles(fullPath));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      results.push(fullPath);
    }
  }
  return results;
}

function dirExists(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

interface SeriesInfo {
  name: string;
  posts: Array<{ title: string; path: string; absPath: string; draft: boolean }>;
}

function collectSeries(root: string): Map<string, SeriesInfo> {
  const blogDir = join(root, 'src', 'content', 'blog');
  const files = listBlogFiles(blogDir);
  const seriesMap = new Map<string, SeriesInfo>();

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const { data } = matter(content);
      const seriesName = data.series;
      if (!seriesName || typeof seriesName !== 'string') continue;

      if (!seriesMap.has(seriesName)) {
        seriesMap.set(seriesName, { name: seriesName, posts: [] });
      }

      seriesMap.get(seriesName)!.posts.push({
        title: String(data.title || 'Untitled'),
        path: filePath.replace(root + '/', ''),
        absPath: filePath,
        draft: data.draft === true,
      });
    } catch {
      // skip unreadable files
    }
  }

  return seriesMap;
}

export async function seriesListCommand(): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  const seriesMap = collectSeries(root);

  if (seriesMap.size === 0) {
    console.log(C.muted('No series found. Use --series when creating a post.'));
    console.log(C.muted('  vg new post "Title" --series "My Series"'));
    return;
  }

  console.log(C.accent('\nSeries\n'));
  console.log(C.dim('─'.repeat(50)));

  const sorted = Array.from(seriesMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const s of sorted) {
    const draftCount = s.posts.filter(p => p.draft).length;
    const draftLabel = draftCount > 0 ? C.warning(` (${draftCount} draft)`) : '';
    console.log(`  ${C.accent(s.name.padEnd(20))} ${C.text(String(s.posts.length))} posts${draftLabel}`);
  }
}

export async function seriesShowCommand(seriesName: string): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  const seriesMap = collectSeries(root);
  const series = seriesMap.get(seriesName);

  if (!series) {
    console.log(C.error(`✗ Series not found: ${seriesName}`));
    const available = Array.from(seriesMap.keys());
    if (available.length > 0) {
      console.log(C.muted(`Available: ${available.join(', ')}`));
    }
    return;
  }

  console.log(C.accent(`\n${series.name}\n`));
  console.log(C.dim('─'.repeat(50)));

  for (const post of series.posts) {
    const draft = post.draft ? C.warning(' [draft]') : '';
    console.log(`  ${C.accent('▸')} ${link(C.text(post.title), post.absPath)}${draft}`);
    console.log(`    ${C.muted(post.path)}`);
  }
}
