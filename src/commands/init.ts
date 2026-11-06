import { execFileSync, spawn } from 'child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, isAbsolute, join, relative, resolve } from 'path';
import ora from 'ora';
import type { InitOptions } from '../types.js';
import { C } from '../utils/helpers.js';
import { fail } from '../utils/output.js';
import { allowBuildsBlock } from '../utils/pnpm-settings.js';

/** owner/repo on GitHub; anything else could smuggle extra arguments into git */
const TEMPLATE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** A git tag, branch or commit; same reason */
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const THEME_PACKAGE = '@vergil-astro/theme';

/**
 * Create a site from the theme repo's starter/: the demo site you see on the Vergil website,
 * wired to the theme as an npm package. The site only holds content and config; upgrading the
 * theme is `vg upgrade`. Repos without starter/ (theme versions before the npm package) are
 * copied whole, as before.
 */
export async function initCommand(dir: string | undefined, options: InitOptions): Promise<void> {
  // `vg init my-site` creates the folder, like `hexo init`; plain `vg init` uses the current one
  const targetDir = dir === undefined ? process.cwd() : siteFolder(dir);
  if (!targetDir) {
    return fail(`The site folder must be inside the current directory: ${dir}`, 'Go to where the site should live, then run: vg init my-site');
  }
  const cdInto = targetDir === process.cwd() ? null : relative(process.cwd(), targetDir);
  if (existsSync(targetDir) && !statSync(targetDir).isDirectory()) {
    return fail(`Not a folder: ${cdInto}`);
  }

  // Already initialized — treat as success
  if (existsSync(join(targetDir, 'package.json')) && existsSync(join(targetDir, 'astro.config.mjs'))) {
    console.log(C.success('✓ Vergil project already initialized.\n'));
    printNextSteps(cdInto);
    return;
  }

  // Partial / unrelated project — prevent overwriting
  if (existsSync(join(targetDir, 'package.json'))) {
    return fail(
      `${cdInto ? `The folder ${cdInto}` : 'Current directory'} already contains a project.`,
      'Run `vg init` in an empty folder, or give a new folder name: vg init my-site',
    );
  }

  const template = options.template || 'vergil-astro/vergil-astro-theme';
  if (!options.from && (!TEMPLATE_RE.test(template) || template.split('/').some(part => part === '.' || part === '..'))) {
    return fail(`--template must be a GitHub repo written as owner/repo: ${template}`);
  }
  if (options.ref && !REF_RE.test(options.ref)) {
    return fail(`--ref must be a tag, branch or commit: ${options.ref}`);
  }

  const spinner = ora({
    text: C.muted('Initializing Vergil project...'),
    spinner: 'dots',
    color: 'yellow',
  }).start();

  let tmp: string | null = null;
  let created = false;
  try {
    // Where the theme repo comes from: a local checkout (--from), or a shallow clone of a release
    let repoDir: string;
    if (options.from) {
      repoDir = resolve(options.from);
      if (!existsSync(join(repoDir, 'package.json'))) throw new Error(`--from is not a theme checkout: ${repoDir}`);
    } else {
      const ref = options.ref ?? latestReleaseTag(template);
      tmp = mkdtempSync(join(tmpdir(), 'vergil-init-'));
      repoDir = join(tmp, 'repo');
      const args = ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), `https://github.com/${template}.git`, repoDir];
      execFileSync('git', args, { stdio: 'ignore' });
    }

    // Only now, with the theme repo in hand, so a failed download leaves no empty folder behind
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      created = true;
    }

    const starter = join(repoDir, 'starter');
    if (existsSync(starter)) {
      copySite(starter, targetDir);
      wirePackage(targetDir, options.theme ?? themeRange(repoDir));
      writePnpmSettings(repoDir, targetDir);
      spinner.succeed(C.success('✓ Site created from the starter'));
    } else {
      // Theme versions before the npm package: the repo itself is the site
      copySite(repoDir, targetDir);
      spinner.succeed(C.success('✓ Template copied'));
    }

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
      if (cdInto) console.log(C.muted(`\n  The site is in ${cdInto}/; afterwards: cd ${cdInto}`));
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
      printNextSteps(cdInto);
    }

  } catch (e) {
    spinner.fail(C.error('Failed to initialize project'));
    // The folder was made by this run moments ago; don't leave half a site in it
    if (created) rmSync(targetDir, { recursive: true, force: true });
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/** The folder for `vg init <dir>`, kept inside the current directory; null when it would land elsewhere */
function siteFolder(dir: string): string | null {
  const cwd = process.cwd();
  const target = resolve(cwd, dir);
  const rel = relative(cwd, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/** Copy a site folder, leaving out git data, installs and build output */
function copySite(from: string, to: string): void {
  const skip = new Set(['.git', 'node_modules', 'dist', '.astro']);
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !skip.has(basename(src)),
  });
}

/** The starter depends on the theme through the workspace; a real site depends on the published package */
function wirePackage(siteDir: string, themeSpec: string): void {
  const file = join(siteDir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const name = basename(siteDir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '');
  if (name) pkg.name = name;
  pkg.dependencies = { ...pkg.dependencies, [THEME_PACKAGE]: themeSpec };
  writeFileSync(file, JSON.stringify(pkg, null, 4) + '\n');
}

/** The new site takes the theme repo's allowBuilds block (and the comment above it), see pnpm-settings.ts */
function writePnpmSettings(repoDir: string, siteDir: string): void {
  const source = join(repoDir, 'pnpm-workspace.yaml');
  const target = join(siteDir, 'pnpm-workspace.yaml');
  if (!existsSync(source) || existsSync(target)) return;
  const block = allowBuildsBlock(readFileSync(source, 'utf8'));
  if (block) writeFileSync(target, block);
}

/** ^<version> of the theme in this checkout */
function themeRange(repoDir: string): string {
  const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
  return `^${pkg.version}`;
}

/** Newest stable vX.Y.Z tag at 1.0.0 or later; null when the repo has none, which means the default branch */
export function latestReleaseTag(template: string): string | null {
  let out = '';
  try {
    out = execFileSync('git', ['ls-remote', '--tags', '--refs', `https://github.com/${template}.git`], { encoding: 'utf8' });
  } catch {
    return null;
  }
  return pickReleaseTag(out.split('\n').map((line) => line.split('refs/tags/')[1]).filter(Boolean));
}

export function pickReleaseTag(tags: string[]): string | null {
  const releases = tags
    .map((tag) => ({ tag, m: /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) }))
    .filter((t): t is { tag: string; m: RegExpExecArray } => t.m !== null && Number(t.m[1]) >= 1)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]) || Number(b.m[2]) - Number(a.m[2]) || Number(b.m[3]) - Number(a.m[3]));
  return releases[0]?.tag ?? null;
}

function printNextSteps(cdInto: string | null): void {
  console.log(`\n${C.subtitle('Next steps:')}`);
  if (cdInto) console.log(`  ${C.accent(`cd ${cdInto}`)}`);
  console.log(`  ${C.accent('vg reset')}               ${C.muted('← clear the sample content (vg reset --dry to preview)')}`);
  console.log(`  ${C.accent('vg new post')} "Hello"     ${C.muted('← write your first post')}`);
  console.log(`  ${C.accent('vg serve')}               ${C.muted('← start dev server')}`);
}
