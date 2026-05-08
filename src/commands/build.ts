import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';

function detectPackageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

export async function buildCommand(): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  const pm = detectPackageManager(root);
  console.log(C.accent('Building for production...'));

  try {
    execSync(`${pm} astro build`, {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    } as unknown as Parameters<typeof execSync>[1]);
    console.log(C.success('✓ Build complete'));
    console.log(C.muted('  Output: dist/'));
  } catch (e) {
    console.log(C.error('✗ Build failed'));
    process.exit(1);
  }
}
