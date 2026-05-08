import { readFileSync, writeFileSync, readdirSync } from 'fs';
import matter from 'gray-matter';
import { join } from 'path';
import readline from 'readline';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { generateFrontmatter } from '../utils/frontmatter.js';

interface DraftEntry {
  title: string;
  path: string;
  type: string;
  relpath: string;
}

function findDraftsRecursive(dir: string, type: string, root: string): DraftEntry[] {
  const results: DraftEntry[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findDraftsRecursive(fullPath, type, root));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          const { data } = matter(content);
          if (data.draft === true) {
            results.push({
              title: String(data.title || entry.name),
              path: fullPath,
              type,
              relpath: fullPath.replace(root + '/', ''),
            });
          }
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

function listAllDrafts(root: string): DraftEntry[] {
  const types = ['blog', 'pages', 'projects', 'albums', 'thoughts', 'docs'];
  const all: DraftEntry[] = [];
  for (const type of types) {
    const dir = join(root, 'src', 'content', type);
    all.push(...findDraftsRecursive(dir, type, root));
  }
  return all;
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function interactivePublish(root: string): Promise<void> {
  const drafts = listAllDrafts(root);

  if (drafts.length === 0) {
    console.log(C.success('✓ No drafts to publish'));
    return;
  }

  console.log(C.accent('\nDrafts\n'));
  console.log(C.dim('─'.repeat(60)));

  drafts.forEach((d, i) => {
    const draftLabel = C.warning(' [draft]');
    console.log(`  ${C.accent(`${i + 1}.`)} ${C.text(d.title)}${draftLabel}`);
    console.log(`     ${C.muted(d.relpath)}`);
  });

  console.log();
  const answer = await askQuestion(C.accent('Pick a number to publish (or press Enter to cancel): '));
  const num = parseInt(answer.trim(), 10);

  if (isNaN(num) || num < 1 || num > drafts.length) {
    console.log(C.muted('Cancelled.'));
    return;
  }

  await publishFile(drafts[num - 1].path, root);
}

async function publishFile(filePath: string, root: string): Promise<void> {
  const content = readFileSync(filePath, 'utf8');
  const { data, content: body } = matter(content);

  if (!data.draft) {
    console.log(C.warning('⚠ This content is already published'));
    return;
  }

  data.draft = false;

  const fm = generateFrontmatter(data);
  const newContent = body.trim() ? `${fm}\n\n${body.trim()}\n` : `${fm}\n`;
  writeFileSync(filePath, newContent);

  console.log(C.success(`✓ Published: ${C.accent(filePath.replace(root + '/', ''))}`));
}

export async function publishCommand(slug?: string): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  if (!slug) {
    await interactivePublish(root);
    return;
  }

  // Find by slug across all content types
  const types = ['blog', 'pages', 'projects', 'albums', 'thoughts', 'docs'];
  for (const type of types) {
    const dir = join(root, 'src', 'content', type);
    const drafts = findDraftsRecursive(dir, type, root);
    const match = drafts.find(d => {
      const baseName = d.relpath.split('/').pop() || '';
      const fileSlug = baseName.replace(/^\d{4}-\d{2}-\d{2}--/, '').replace(/-\d+\.md$/, '');
      return fileSlug === slug || d.relpath.includes(slug);
    });
    if (match) {
      await publishFile(match.path, root);
      return;
    }
  }

  console.log(C.error(`✗ No draft found matching: ${slug}`));
  console.log(C.muted('  Run `vg publish` without arguments to see all drafts'));
}
