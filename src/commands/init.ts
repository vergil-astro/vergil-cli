import { execFileSync, spawn } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import ora from 'ora';
import type { InitOptions } from '../types.js';
import { C } from '../utils/helpers.js';
import { fail } from '../utils/output.js';

/** owner/repo on GitHub; anything else could smuggle extra arguments into git */
const TEMPLATE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function initCommand(options: InitOptions): Promise<void> {
  const targetDir = process.cwd();

  // Already initialized — treat as success
  if (existsSync(join(targetDir, 'package.json')) && existsSync(join(targetDir, 'astro.config.mjs'))) {
    console.log(C.success('✓ Vergil project already initialized.\n'));
    printNextSteps();
    return;
  }

  // Partial / unrelated project — prevent overwriting
  if (existsSync(join(targetDir, 'package.json'))) {
    return fail('Current directory already contains a project.', 'Run `vg init` in an empty folder.');
  }

  const template = options.template || 'vergil-astro/vergil-astro-theme';
  if (!TEMPLATE_RE.test(template) || template.split('/').some(part => part === '.' || part === '..')) {
    return fail(`--template must be a GitHub repo written as owner/repo: ${template}`);
  }

  const spinner = ora({
    text: C.muted('Initializing Vergil project...'),
    spinner: 'dots',
    color: 'yellow',
  }).start();

  try {
    // Clone the theme
    execFileSync('git', ['clone', '--depth', '1', `https://github.com/${template}.git`, '.'], { cwd: targetDir, stdio: 'ignore' });

    // Remove .git
    rmSync(join(targetDir, '.git'), { recursive: true, force: true });

    spinner.succeed(C.success('✓ Template cloned'));

    // Install dependencies
    if (!options.skipInstall) {
      const installSpinner = ora({
        text: C.muted('Installing dependencies...'),
        spinner: 'dots',
        color: 'yellow',
      }).start();

      try {
        execFileSync('pnpm', ['install'], { cwd: targetDir, stdio: 'ignore' });
        installSpinner.succeed(C.success('✓ Dependencies installed'));
      } catch {
        installSpinner.warn(C.warning('⚠ pnpm install failed, try running it manually'));
      }
    }

    // Start dev server
    if (!options.skipServe) {
      console.log(C.accent('\n  Starting dev server...'));
      const child = spawn('pnpm', ['astro', 'dev'], {
        cwd: targetDir,
        stdio: 'inherit',
        shell: true,
      });

      child.on('exit', (code: number | null) => {
        if (code !== 0 && code !== null) fail(`Server exited with code ${code}`);
      });
    } else {
      printNextSteps();
    }

  } catch (e) {
    spinner.fail(C.error('Failed to initialize project'));
    fail(e instanceof Error ? e.message : String(e));
  }
}

function printNextSteps(): void {
  console.log(`\n${C.subtitle('Next steps:')}`);
  console.log(`  ${C.accent('pnpm reset')}             ${C.muted('← clear the demo content (pnpm reset:dry to preview)')}`);
  console.log(`  ${C.accent('vg new post')} "Hello"     ${C.muted('← write your first post')}`);
  console.log(`  ${C.accent('vg serve')}               ${C.muted('← start dev server')}`);
}
