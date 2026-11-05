import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { fail, NOT_IN_SITE_HINT } from '../utils/output.js';

export async function cleanCommand(): Promise<void> {
  const root = getProjectRoot();
  if (!root) return fail('Not in a Vergil project.', NOT_IN_SITE_HINT);

  const dirsToClean = ['dist', '.astro', 'node_modules/.vite'];

  for (const dir of dirsToClean) {
    const fullPath = join(root, dir);
    if (existsSync(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true });
      console.log(C.success(`✓ Cleaned: ${dir}`));
    }
  }

  console.log(C.accent('\nCache and build output cleaned.'));
}
