import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getProjectRoot } from '../utils/file.js';
import { currentLang, t } from '../utils/i18n.js';
import { fail, failNotInSite } from '../utils/output.js';

/**
 * Content tools: tidy and check images, check directive syntax, print the directive reference,
 * clear the sample content. Each one is a script in tools/ that works on the site it runs in,
 * so they run as their own Node process with the site folder as the working directory.
 * They speak the language this run resolved, passed to them as VG_LANG.
 */
export type ToolName = 'organize-images' | 'check-images' | 'expand-images' | 'check-directives' | 'directive-ref' | 'reset-content';

export function runTool(name: ToolName, args: string[] = []): void {
  const root = getProjectRoot();
  if (!root) return failNotInSite();

  const script = fileURLToPath(new URL(`../../tools/${name}.mjs`, import.meta.url));
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VG_LANG: currentLang() },
  });
  if (result.error) return fail(t('tools.runFailed', { name, error: result.error.message }));
  if (result.status) process.exitCode = result.status;
}
