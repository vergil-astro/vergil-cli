import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ServeOptions } from '../types.js';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { fail, NOT_IN_SITE_HINT } from '../utils/output.js';

function detectPackageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm'; // fallback
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const root = getProjectRoot();
  if (!root) return fail('Not in a Vergil project.', NOT_IN_SITE_HINT);

  const pm = detectPackageManager(root);
  const port = options.port || '4321';
  // The command runs through a shell, so only a plain port number may go in
  if (!/^\d{1,5}$/.test(port)) return fail(`--port must be a number: ${port}`);

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
    if (code !== 0 && code !== null) fail(`Server exited with code ${code}`);
  });
}
