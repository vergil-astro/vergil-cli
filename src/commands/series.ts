import { readFileSync } from 'fs';
import { join, relative } from 'path';
import matter from 'gray-matter';
import { C, link } from '../utils/helpers.js';
import { getProjectRoot, listMarkdownFiles } from '../utils/file.js';
import { loadSeriesDefs, findSeriesDef, resolvePostSeries } from '../utils/series.js';

interface SeriesInfo {
  id: string;
  name: string;
  dir?: string;
  posts: Array<{ title: string; path: string; absPath: string; draft: boolean; date: number }>;
}

/**
 * Group blog posts by series. Series defined in src/content/series/ are listed
 * even when empty; a post can join one through `series:` or by sitting in the
 * folder the series claims with `dir`.
 */
function collectSeries(root: string): Map<string, SeriesInfo> {
  const blogDir = join(root, 'src', 'content', 'blog');
  const defs = loadSeriesDefs(root);
  const seriesMap = new Map<string, SeriesInfo>();

  for (const def of defs) {
    seriesMap.set(def.id, { ...def, posts: [] });
  }

  for (const filePath of listMarkdownFiles(blogDir)) {
    try {
      const { data } = matter(readFileSync(filePath, 'utf8'));
      const series = resolvePostSeries(data.series, relative(blogDir, filePath), defs);
      if (!series) continue;

      if (!seriesMap.has(series.id)) {
        seriesMap.set(series.id, { ...series, posts: [] });
      }

      seriesMap.get(series.id)!.posts.push({
        title: String(data.title || 'Untitled'),
        path: filePath.replace(root + '/', ''),
        absPath: filePath,
        draft: data.draft === true,
        date: new Date(data.publishDate).getTime() || 0,
      });
    } catch {
      // skip unreadable files
    }
  }

  // A series is a reading order, so oldest first — same as the theme
  for (const s of seriesMap.values()) {
    s.posts.sort((a, b) => a.date - b.date);
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
    const dirLabel = s.dir ? C.muted(`  blog/${s.dir}/`) : '';
    console.log(`  ${C.accent(s.name.padEnd(20))} ${C.text(String(s.posts.length))} posts${draftLabel}${dirLabel}`);
  }
}

export async function seriesShowCommand(seriesName: string): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  const seriesMap = collectSeries(root);
  const match = findSeriesDef(Array.from(seriesMap.values()), seriesName);
  const series = match && seriesMap.get(match.id);

  if (!series) {
    console.log(C.error(`✗ Series not found: ${seriesName}`));
    const available = Array.from(seriesMap.values()).map(s => s.name);
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
