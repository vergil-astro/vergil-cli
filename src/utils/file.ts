import { existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * Detect if current directory is a Vergil project
 */
export function isVergilProject(dir: string = process.cwd()): boolean {
  return existsSync(join(dir, 'astro.config.mjs')) ||
    existsSync(join(dir, 'astro.config.ts')) ||
    existsSync(join(dir, 'src', 'data', 'config'));
}

/**
 * Get Vergil project root by walking up directories
 */
export function getProjectRoot(dir: string = process.cwd()): string | null {
  let current = resolve(dir);
  const root = resolve('/');
  while (current !== root) {
    if (isVergilProject(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Ensure directory exists (create recursively)
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a URL-friendly slug from title.
 * Mirrors the theme's slugify (src/utils/common-utils.ts): CJK characters are
 * kept, so Chinese titles get Chinese filenames instead of an empty slug.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^一-龥぀-ヿa-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '-')
    .substring(0, 80)
    .replace(/-+$/, '');
}

/**
 * Collect every Markdown file under a directory, recursively
 */
export function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get next available filename index in a directory
 * Extracts the numeric suffix from filenames like "2024-01-01--slug-3.md"
 */
export function getNextIndex(dir: string): number {
  if (!existsSync(dir)) return 1;
  const files = readdirSync(dir);
  const nums = files
    .map(f => {
      const match = f.match(/-(\d+)\.(md|mdx|json)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
  return Math.max(0, ...nums) + 1;
}
