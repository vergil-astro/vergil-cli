import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import ora from 'ora';
import type { InitOptions } from '../types.js';
import { C } from '../utils/helpers.js';

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
    console.log(C.warning('⚠ Current directory already contains a project.'));
    return;
  }

  const spinner = ora({
    text: C.muted('Initializing Vergil project...'),
    spinner: 'dots',
    color: 'yellow',
  }).start();

  try {
    // Clone the theme
    const template = options.template || 'vergil-astro/vergil-astro-theme';
    execSync(
      `git clone --depth 1 https://github.com/${template}.git .`,
      { cwd: targetDir, stdio: 'ignore' }
    );

    // Remove .git
    execSync('rm -rf .git', { cwd: targetDir, stdio: 'ignore' });

    spinner.succeed(C.success('✓ Template cloned'));

    // Install dependencies
    if (!options.skipInstall) {
      const installSpinner = ora({
        text: C.muted('Installing dependencies...'),
        spinner: 'dots',
        color: 'yellow',
      }).start();

      try {
        execSync('pnpm install', { cwd: targetDir, stdio: 'ignore' });
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
        if (code !== 0 && code !== null) {
          console.log(C.error(`Server exited with code ${code}`));
        }
      });
    } else {
      printNextSteps();
    }

  } catch (e) {
    spinner.fail(C.error('Failed to initialize project'));
    if (e instanceof Error) {
      console.log(C.muted(e.message));
    }
  }
}

function printNextSteps(): void {
  console.log(`\n${C.subtitle('Next steps:')}`);
  console.log(`  ${C.accent('pnpm reset')}             ${C.muted('← clear the demo content (pnpm reset:dry to preview)')}`);
  console.log(`  ${C.accent('vg new post')} "Hello"     ${C.muted('← write your first post')}`);
  console.log(`  ${C.accent('vg serve')}               ${C.muted('← start dev server')}`);
}
