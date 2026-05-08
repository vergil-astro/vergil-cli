import { readdirSync, readFileSync, statSync, existsSync, type Dirent } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function isMarkdown(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.mdx');
}

function isCountableDoc(name: string): boolean {
  return isMarkdown(name) && name !== '_meta.md' && name !== '_meta.mdx';
}

function dirExists(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReadDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readDocMeta(filePath: string): { title?: string; draft?: boolean } {
  try {
    const { data } = matter(readFileSync(filePath, 'utf8'));
    return {
      title: typeof data.title === 'string' ? data.title : undefined,
      draft: data.draft === true,
    };
  } catch {
    return {};
  }
}

function readMetaTitle(bookDir: string): string | undefined {
  const metaPath = join(bookDir, '_meta.md');
  if (!existsSync(metaPath)) return undefined;
  try {
    const { data } = matter(readFileSync(metaPath, 'utf8'));
    return typeof data.title === 'string' ? data.title : undefined;
  } catch {
    return undefined;
  }
}

// ── Book list (`vg docs` / `vg docs list`) ──────────────────────────────────

interface BookInfo {
  id: string;
  title?: string;
  path: string;
  docCount: number;
  draftCount: number;
}

function countDocsRecursive(dir: string): { docs: number; drafts: number } {
  let docs = 0;
  let drafts = 0;
  for (const entry of safeReadDir(dir)) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countDocsRecursive(fullPath);
      docs += sub.docs;
      drafts += sub.drafts;
    } else if (entry.isFile() && isCountableDoc(entry.name)) {
      docs++;
      if (readDocMeta(fullPath).draft) drafts++;
    }
  }
  return { docs, drafts };
}

function listBooks(docsDir: string): BookInfo[] {
  if (!dirExists(docsDir)) return [];
  return safeReadDir(docsDir)
    .filter(e => e.isDirectory())
    .map(e => {
      const bookPath = join(docsDir, e.name);
      const { docs, drafts } = countDocsRecursive(bookPath);
      return {
        id: e.name,
        title: readMetaTitle(bookPath),
        path: bookPath,
        docCount: docs,
        draftCount: drafts,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function docsListCommand(): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  const docsDir = join(root, 'src', 'content', 'docs');
  const books = listBooks(docsDir);

  if (books.length === 0) {
    console.log(C.muted('No docs found in src/content/docs/.'));
    console.log(C.muted('  Create one with: vg new doc "Title" --path <book>/<chapter>'));
    return;
  }

  console.log(C.accent('\nDocs\n'));
  console.log(C.dim('─'.repeat(60)));

  const idWidth = Math.max(...books.map(b => b.id.length), 12);
  for (const book of books) {
    const draftLabel = book.draftCount > 0
      ? C.warning(` (${book.draftCount} draft${book.draftCount > 1 ? 's' : ''})`)
      : '';
    const title = book.title ? C.muted(`  ${book.title}`) : '';
    console.log(
      `  ${C.accent(book.id.padEnd(idWidth))}  ` +
      `${C.text(String(book.docCount).padStart(3))} docs${draftLabel}${title}`
    );
  }

  const totalDocs = books.reduce((sum, b) => sum + b.docCount, 0);
  const totalDrafts = books.reduce((sum, b) => sum + b.draftCount, 0);
  const draftSuffix = totalDrafts > 0 ? `, ${totalDrafts} draft${totalDrafts > 1 ? 's' : ''}` : '';
  console.log(C.muted(`\nTotal: ${books.length} books, ${totalDocs} docs${draftSuffix}`));
  console.log(C.muted(`Use \`vg docs <book>\` to view a book's chapter tree.`));
}

// ── Tree (`vg docs <book>` / `vg docs show <book>`) ─────────────────────────

interface DocLeaf {
  type: 'doc';
  title: string;
  draft: boolean;
}

interface Category {
  type: 'category';
  name: string;
  docCount: number;
  draftCount: number;
  children: Array<DocLeaf | Category>;
}

/**
 * Build a logical tree where:
 * - A directory whose only countable doc is `index.md` AND has no subdirectories
 *   collapses into a single leaf doc (shown as its title).
 * - Otherwise, the directory is a category and we recurse, plus any `.md` files
 *   inside it are listed as leaf docs (skipping `_meta.md`).
 *
 * Counts on a category are total leaf docs (and drafts) underneath it.
 */
function buildCategory(dir: string, name: string): Category {
  const entries = safeReadDir(dir);
  const subDirs = entries.filter(e => e.isDirectory());
  const mdFiles = entries.filter(e => e.isFile() && isCountableDoc(e.name));

  const children: Array<DocLeaf | Category> = [];

  // Subdirectories: each is either a leaf doc (collapse) or a category (recurse).
  for (const subDir of subDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const subPath = join(dir, subDir.name);
    const subEntries = safeReadDir(subPath);

    const hasSubDirs = subEntries.some(e => e.isDirectory());
    const indexFile = subEntries.find(
      e => e.isFile() && (e.name === 'index.md' || e.name === 'index.mdx')
    );
    const otherDocs = subEntries.filter(
      e => e.isFile() && isCountableDoc(e.name) && e.name !== 'index.md' && e.name !== 'index.mdx'
    );

    if (!hasSubDirs && indexFile && otherDocs.length === 0) {
      // Leaf doc: collapse `<dir>/index.md` to a single titled entry.
      const meta = readDocMeta(join(subPath, indexFile.name));
      children.push({
        type: 'doc',
        title: meta.title || subDir.name,
        draft: !!meta.draft,
      });
    } else {
      children.push(buildCategory(subPath, subDir.name));
    }
  }

  // Loose `.md` files at this level (e.g. README.md): each is a leaf doc.
  for (const mdFile of mdFiles.sort((a, b) => a.name.localeCompare(b.name))) {
    const meta = readDocMeta(join(dir, mdFile.name));
    children.push({
      type: 'doc',
      title: meta.title || mdFile.name.replace(/\.mdx?$/, ''),
      draft: !!meta.draft,
    });
  }

  let docCount = 0;
  let draftCount = 0;
  for (const child of children) {
    if (child.type === 'doc') {
      docCount++;
      if (child.draft) draftCount++;
    } else {
      docCount += child.docCount;
      draftCount += child.draftCount;
    }
  }

  return { type: 'category', name, docCount, draftCount, children };
}

function renderNode(node: DocLeaf | Category, prefix: string, isLast: boolean): void {
  const branch = isLast ? '└─ ' : '├─ ';

  if (node.type === 'doc') {
    const draft = node.draft ? C.warning(' [draft]') : '';
    console.log(`${prefix}${C.dim(branch)}${C.text(node.title)}${draft}`);
    return;
  }

  const count = node.docCount > 0 ? C.muted(`  (${node.docCount})`) : '';
  console.log(`${prefix}${C.dim(branch)}${C.accent(node.name + '/')}${count}`);

  const childPrefix = prefix + (isLast ? '    ' : C.dim('│   '));
  node.children.forEach((child, i) => {
    renderNode(child, childPrefix, i === node.children.length - 1);
  });
}

export async function docsShowCommand(bookName: string): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  const docsDir = join(root, 'src', 'content', 'docs');
  const bookDir = join(docsDir, bookName);

  if (!dirExists(bookDir)) {
    console.log(C.error(`✗ Book not found: ${bookName}`));
    const books = listBooks(docsDir);
    if (books.length > 0) {
      console.log(C.muted(`Available: ${books.map(b => b.id).join(', ')}`));
    }
    return;
  }

  const tree = buildCategory(bookDir, bookName);
  const metaTitle = readMetaTitle(bookDir);

  const draftSuffix = tree.draftCount > 0
    ? `, ${tree.draftCount} draft${tree.draftCount > 1 ? 's' : ''}`
    : '';
  const summary = `(${tree.docCount} doc${tree.docCount !== 1 ? 's' : ''}${draftSuffix})`;
  const titlePart = metaTitle ? `  ${C.muted(metaTitle)}` : '';

  console.log(`\n${C.accent(bookName)}  ${C.muted(summary)}${titlePart}`);
  console.log(C.dim('─'.repeat(60)));

  if (tree.children.length === 0) {
    console.log(C.muted('  (empty)'));
    return;
  }

  tree.children.forEach((child, i) => {
    renderNode(child, '  ', i === tree.children.length - 1);
  });

  console.log();
}
