import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getProjectRoot } from '../utils/file.js';
import { fail, NOT_IN_SITE_HINT } from '../utils/output.js';

/**
 * Content tools: tidy and check images, check directive syntax, print the directive reference,
 * clear the sample content. Each one is a script in tools/ that works on the site it runs in,
 * so they run as their own Node process with the site folder as the working directory.
 */
export type ToolName = 'organize-images' | 'check-images' | 'expand-images' | 'check-directives' | 'directive-ref' | 'reset-content';

export function runTool(name: ToolName, args: string[] = []): void {
  const root = getProjectRoot();
  if (!root) return fail('Not in a Vergil project.', NOT_IN_SITE_HINT);

  const script = fileURLToPath(new URL(`../../tools/${name}.mjs`, import.meta.url));
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) return fail(`Could not run ${name}: ${result.error.message}`);
  if (result.status) process.exitCode = result.status;
}
