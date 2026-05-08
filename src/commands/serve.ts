import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ServeOptions } from '../types.js';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';

function detectPackageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm'; // fallback
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project. Run `vg init` first.'));
    return;
  }

  const pm = detectPackageManager(root);
  const port = options.port || '4321';

  console.log(C.accent(`Starting dev server on http://localhost:${port} (${pm})`));

  const child = spawn(pm, [
    'astro', 'dev',
    '--port', port,
    ...(options.host ? ['--host', '0.0.0.0'] : []),
  ], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code: number | null) => {
    if (code !== 0 && code !== null) {
      console.log(C.error(`Server exited with code ${code}`));
    }
  });
}
