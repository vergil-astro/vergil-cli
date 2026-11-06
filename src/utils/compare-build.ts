import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Compare two Astro builds page by page, ignoring what changes on every build anyway:
 * hashed asset names, Astro's scoped-style ids, generated element ids, and theme output that
 * depends on the build time (mind map ids, encrypted directive payloads, today's cell in plans).
 */
export function normalizeHtml(html: string): string {
  return html
    .replace(/\/_astro\/[^"' )>]+/g, '/_astro/X')
    .replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid')
    .replace(/astro-island[^>]*?uid="[^"]*"/g, 'astro-island')
    .replace(/\b([a-z]+)-[a-z0-9]{5,8}(?=[-"\s])/g, '$1-R')
    .replace(/mind-\d+-/g, 'mind-T-')
    .replace(/data-payload="[^"]*"/g, 'data-payload="P"')
    .replace(/ md-R-cell--today/g, '')
    .replace(/>\s*</g, '>\n<');
}

function htmlPages(root: string): Map<string, string> {
  const pages = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.html')) pages.set(relative(root, full), full);
    }
  };
  walk(root);
  return pages;
}

export interface BuildDiff {
  total: number;
  missing: string[];
  added: string[];
  changed: string[];
}

export function compareBuilds(before: string, after: string): BuildDiff {
  const a = htmlPages(before);
  const b = htmlPages(after);
  const missing = [...a.keys()].filter((k) => !b.has(k)).sort();
  const added = [...b.keys()].filter((k) => !a.has(k)).sort();
  const changed: string[] = [];
  for (const [rel, file] of a) {
    const other = b.get(rel);
    if (other && normalizeHtml(readFileSync(file, 'utf8')) !== normalizeHtml(readFileSync(other, 'utf8'))) changed.push(rel);
  }
  return { total: a.size, missing, added, changed: changed.sort() };
}
