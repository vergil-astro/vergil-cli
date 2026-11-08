import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { DeployOptions } from '../types.js';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { fail, failNotInSite } from '../utils/output.js';
import { t } from '../utils/i18n.js';

const TARGETS = ['github', 'vercel', 'netlify'];

/** Is a command on PATH */
function hasCommand(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectPackageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  const root = getProjectRoot();
  if (!root) return failNotInSite();

  const target = options.target || 'github';
  if (!TARGETS.includes(target)) return fail(t('deploy.unknownTarget', { target }), t('common.available', { list: TARGETS.join(', ') }));
  const pkgPath = join(root, 'package.json');
  const pm = detectPackageManager(root);

  // Always build first
  console.log(C.accent(t('common.buildingProduction')));
  try {
    execSync(`${pm} run build`, { cwd: root, stdio: 'inherit' });
  } catch {
    return fail(t('deploy.buildFailed'), t('common.buildOutputHint'));
  }

  if (target === 'github') {
    try {
      execSync('git remote get-url origin', { cwd: root, stdio: 'ignore' });
    } catch {
      return fail(t('deploy.noRemote'), t('deploy.run', { command: 'git remote add origin https://github.com/username/repo.git' }));
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

    console.log(C.accent(t('deploy.toGithub')));
    try {
      execSync(`${pm} run deploy`, { cwd: root, stdio: 'inherit' });
      console.log(C.success(t('deploy.githubDone')));
    } catch {
      fail(t('deploy.failed'), t('common.outputHint'));
    }

  } else if (target === 'vercel') {
    if (!hasCommand('vercel')) return fail(t('deploy.noVercel'), t('deploy.run', { command: 'npm i -g vercel' }));
    try {
      execSync('vercel --prod', { cwd: root, stdio: 'inherit' });
    } catch {
      fail(t('deploy.failed'), t('common.outputHint'));
    }

  } else if (target === 'netlify') {
    if (!hasCommand('netlify')) return fail(t('deploy.noNetlify'), t('deploy.run', { command: 'npm i -g netlify-cli' }));
    try {
      execSync('netlify deploy --prod --dir=dist', { cwd: root, stdio: 'inherit' });
    } catch {
      fail(t('deploy.failed'), t('common.outputHint'));
    }
  }
}
