import { readFileSync, writeFileSync, readdirSync } from 'fs';
import matter from 'gray-matter';
import { join } from 'path';
import readline from 'readline';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { canPrompt, fail, warn, sitePath, NOT_IN_SITE_HINT } from '../utils/output.js';

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

  // Picking from a list needs a person at the terminal; agents and scripts pass the slug
  if (!canPrompt) {
    return fail(
      'No draft given',
      'Pass the one to publish: vg publish <slug>',
      ...drafts.map(d => `${(d.relpath.split('/').pop() || '').replace(/\.mdx?$/, '')}  (${d.relpath})`),
    );
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

/**
 * Flip `draft: true` to `false` in place. Re-serializing the whole frontmatter
 * would turn dates into long Date strings and mangle nested fields such as
 * seo, splash or an album's images list.
 */
async function publishFile(filePath: string, root: string): Promise<void> {
  const content = readFileSync(filePath, 'utf8');
  const { data } = matter(content);

  if (!data.draft) {
    // Already in the state asked for, so not a failure
    warn('This content is already published');
    return;
  }

  const fmEnd = content.indexOf('\n---', 3);
  const frontmatter = content.slice(0, fmEnd);
  const updated = frontmatter.replace(/^draft:\s*(true|yes|on)\s*$/m, 'draft: false');

  if (updated === frontmatter) {
    return fail('Could not find the draft flag in frontmatter', sitePath(root, filePath));
  }

  writeFileSync(filePath, updated + content.slice(fmEnd));

  console.log(C.success(`✓ Published: ${C.accent(sitePath(root, filePath))}`));
}

export async function publishCommand(slug?: string): Promise<void> {
  const root = getProjectRoot();
  if (!root) return fail('Not in a Vergil project.', NOT_IN_SITE_HINT);

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
      const name = (d.relpath.split('/').pop() || '').replace(/\.mdx?$/, '');
      // Older vg versions named files <date>--<slug>-<n>.md
      const legacySlug = name.replace(/^\d{4}-\d{2}-\d{2}--/, '').replace(/-\d+$/, '');
      return name === slug || legacySlug === slug || d.relpath.includes(slug);
    });
    if (match) {
      await publishFile(match.path, root);
      return;
    }
  }

  fail(`No draft found matching: ${slug}`, 'See all drafts with `vg list -d` and `vg docs -d` (add --json for machine-readable output)');
}
