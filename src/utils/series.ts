import { readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import matter from 'gray-matter';
import { listMarkdownFiles, slugify } from './file.js';

export interface SeriesDef {
  id: string;
  name: string;
  dir?: string;
}

/**
 * Series definitions from src/content/series/*.md
 */
export function loadSeriesDefs(root: string): SeriesDef[] {
  const seriesDir = join(root, 'src', 'content', 'series');
  return listMarkdownFiles(seriesDir).flatMap(file => {
    try {
      const { data } = matter(readFileSync(file, 'utf8'));
      const id = slugify(relative(seriesDir, file).replace(/\.mdx?$/, ''));
      const def: SeriesDef = { id, name: typeof data.name === 'string' ? data.name : id };
      if (typeof data.dir === 'string' && data.dir) def.dir = data.dir;
      return [def];
    } catch {
      return [];
    }
  });
}

/**
 * Find a series definition by its file id or display name
 */
export function findSeriesDef(defs: SeriesDef[], query: string): SeriesDef | undefined {
  const id = slugify(query);
  return defs.find(d => d.id === id || d.name === query);
}

/**
 * Which series a post belongs to. Same rule as the theme's resolvePostSeries:
 * the frontmatter `series` wins; otherwise the post's top-level folder under
 * src/content/blog/ is matched against a series definition's `dir`.
 *
 * @param postPath path relative to src/content/blog/
 */
export function resolvePostSeries(series: unknown, postPath: string, defs: SeriesDef[]): SeriesDef | undefined {
  if (typeof series === 'string' && series) {
    const id = slugify(series);
    return defs.find(d => d.id === id) ?? { id, name: series };
  }
  const parts = postPath.split(sep);
  if (parts.length < 2) return undefined;
  const dir = parts[0].toLowerCase();
  return defs.find(d => d.dir && d.dir.toLowerCase() === dir);
}
