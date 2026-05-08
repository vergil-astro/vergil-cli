import matter from 'gray-matter';
import { readFileSync } from 'fs';
import type { ContentMeta } from '../types.js';

/**
 * Read frontmatter from a Markdown file
 */
export function readFrontmatter(filePath: string): ContentMeta | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    const { data } = matter(content);
    return data as ContentMeta;
  } catch {
    return null;
  }
}

/**
 * Generate frontmatter YAML string
 */
export function generateFrontmatter(meta: Record<string, unknown>): string {
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        value.forEach(item => {
          if (typeof item === 'object') {
            lines.push(`  - ${JSON.stringify(item).replace(/"/g, "'")}`);
          } else {
            lines.push(`  - ${item}`);
          }
        });
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) {
        lines.push(`  ${k}: ${v}`);
      }
    } else {
      lines.push(`${key}: '${String(value).replace(/'/g, "\\'")}'`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

