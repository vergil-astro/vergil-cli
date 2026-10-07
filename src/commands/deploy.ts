import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { DeployOptions } from '../types.js';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';

function detectPackageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  const root = getProjectRoot();
  if (!root) {
    console.log(C.error('✗ Not in a Vergil project.'));
    return;
  }

  const target = options.target || 'github';
  const pkgPath = join(root, 'package.json');
  const pm = detectPackageManager(root);

  // Always build first
  console.log(C.accent('Building for production...'));
  try {
    execSync(`${pm} run build`, { cwd: root, stdio: 'inherit' });
  } catch {
    console.log(C.error('✗ Build failed, aborting deploy'));
    return;
  }

  if (target === 'github') {
    try {
      execSync('git remote get-url origin', { cwd: root, stdio: 'ignore' });
    } catch {
      console.log(C.error('✗ No git remote configured'));
      console.log(C.muted('  Run: git remote add origin https://github.com/username/repo.git'));
      return;
    }

    // Install gh-pages if needed
    try {
      execSync(`${pm} add -D gh-pages`, { cwd: root, stdio: 'ignore' });
    } catch {
      // already installed or other error, ignore
    }

    // Add deploy script
    let pkgContent = readFileSync(pkgPath, 'utf8');
    if (!pkgContent.includes('"deploy"')) {
      pkgContent = pkgContent.replace(
        '"scripts": {',
        '"scripts": {\n    "deploy": "gh-pages -d dist",'
      );
      writeFileSync(pkgPath, pkgContent);
    }

    console.log(C.accent('Deploying to GitHub Pages...'));
    try {
      execSync(`${pm} run deploy`, { cwd: root, stdio: 'inherit' });
      console.log(C.success('✓ Deployed to GitHub Pages'));
    } catch {
      console.log(C.error('✗ Deploy failed'));
    }

  } else if (target === 'vercel') {
    try {
      execSync('which vercel', { stdio: 'ignore' });
      execSync('vercel --prod', { cwd: root, stdio: 'inherit' });
    } catch {
      console.log(C.error('✗ Vercel CLI not installed'));
      console.log(C.muted('  Run: npm i -g vercel'));
    }

  } else if (target === 'netlify') {
    try {
      execSync('which netlify', { stdio: 'ignore' });
      execSync('netlify deploy --prod --dir=dist', { cwd: root, stdio: 'inherit' });
    } catch {
      console.log(C.error('✗ Netlify CLI not installed'));
      console.log(C.muted('  Run: npm i -g netlify-cli'));
    }
  }
}
