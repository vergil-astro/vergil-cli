import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { fail, NOT_IN_SITE_HINT } from '../utils/output.js';

function detectPackageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

export async function buildCommand(): Promise<void> {
  const root = getProjectRoot();
  if (!root) return fail('Not in a Vergil project.', NOT_IN_SITE_HINT);

  const pm = detectPackageManager(root);
  console.log(C.accent('Building for production...'));

  try {
    // The theme's build script tidies images before `astro build`
    execSync(`${pm} run build`, {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    } as unknown as Parameters<typeof execSync>[1]);
    console.log(C.success('✓ Build complete'));
    console.log(C.muted('  Output: dist/'));
  } catch {
    fail('Build failed', 'The build output above has the details.');
  }
}
