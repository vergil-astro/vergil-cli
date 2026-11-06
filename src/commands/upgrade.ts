import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { MIGRATIONS } from '../migrations/index.js';
import { compareBuilds } from '../utils/compare-build.js';
import { getProjectRoot } from '../utils/file.js';
import { C } from '../utils/helpers.js';
import { fail, NOT_IN_SITE_HINT } from '../utils/output.js';
import { allowBuildsBlock, mergeAllowBuilds } from '../utils/pnpm-settings.js';
import { compareVersions, inRange, parseVersion } from '../utils/semver.js';
import { detectPackageManager } from './build.js';

const THEME = '@vergil-astro/theme';

export interface UpgradeOptions {
  to?: string;
  dryRun?: boolean;
  skipCheck?: boolean;
}

/**
 * Upgrade the theme package. Users shouldn't have to resolve anything: the site holds only content
 * and config, so an upgrade is a package update plus the migrations of any breaking release in
 * between. To make sure nothing broke, the site is built before and after and the pages compared.
 * Everything happens on a new git branch, so going back is `git switch -`.
 */
export async function upgradeCommand(options: UpgradeOptions): Promise<void> {
  const root = getProjectRoot();
  if (!root) return fail('Not in a Vergil project.', NOT_IN_SITE_HINT);

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!pkg.dependencies?.[THEME] && !pkg.devDependencies?.[THEME]) {
    return fail(
      'This site carries the theme source itself (Vergil 0.x), not the theme package.',
      'vg upgrade works on sites that depend on @vergil-astro/theme. Move this site over once by hand, see the upgrade notes in the Vergil docs.',
    );
  }

  const installedFile = join(root, 'node_modules', '@vergil-astro', 'theme', 'package.json');
  if (!existsSync(installedFile)) return fail('The theme package is not installed yet.', 'Install the dependencies first (pnpm install).');
  const current: string = JSON.parse(readFileSync(installedFile, 'utf8')).version;

  let target = options.to?.replace(/^v/, '');
  if (!target) {
    try {
      target = execFileSync('npm', ['view', THEME, 'version'], { encoding: 'utf8' }).trim();
    } catch {
      return fail('Could not look up the latest theme version on npm.', 'Check the network, or pass the version: vg upgrade --to <version>.');
    }
  }
  if (!parseVersion(target)) return fail(`Not a version: ${target}`);
  if (compareVersions(target, current) <= 0) {
    console.log(C.success(`✓ The theme is already at ${current}.`));
    return;
  }

  const migrations = inRange(MIGRATIONS, current, target);
  const pm = detectPackageManager(root);
  const isGit = existsSync(join(root, '.git'));
  const branch = `vergil-upgrade/${target}`;

  console.log(C.subtitle(`Upgrade @vergil-astro/theme ${current} → ${target}`));
  if (isGit) console.log(C.muted(`  1. Work on a new branch: ${branch}`));
  if (!options.skipCheck) console.log(C.muted('  2. Build the site as it is now, to compare against'));
  console.log(C.muted(`  3. Update the package with ${pm}`));
  if (pm === 'pnpm') console.log(C.muted('       and declare the install scripts the new version brings (allowBuilds in pnpm-workspace.yaml)'));
  console.log(C.muted(migrations.length ? `  4. Run ${migrations.length} migration(s):` : '  4. No migrations needed between these versions'));
  for (const m of migrations) console.log(C.muted(`       ${m.version}  ${m.description}`));
  console.log(C.muted('     Clear Astro\'s content cache, so every page renders with the new theme'));
  if (!options.skipCheck) console.log(C.muted('  5. Build again and compare every page'));
  if (options.dryRun) {
    console.log(C.muted('\n(Dry run: nothing changed. Run without --dry-run to upgrade.)'));
    return;
  }

  if (isGit) {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
    if (dirty) return fail('The site has uncommitted changes.', 'Commit or stash them first, so the upgrade can be undone cleanly.');
    try {
      execFileSync('git', ['switch', '-c', branch], { cwd: root, stdio: 'ignore' });
    } catch {
      return fail(`Could not create the branch ${branch}.`, 'It may already exist from an earlier attempt; delete it or switch to it first.');
    }
  } else {
    console.log(C.warning('⚠ Not a git repository: the upgrade cannot be undone automatically.'));
  }

  let before: string | null = null;
  try {
    if (!options.skipCheck) {
      console.log(C.accent('\nBuilding the current site...'));
      run(pm, ['run', 'build'], root);
      before = mkdtempSync(join(tmpdir(), 'vergil-upgrade-'));
      cpSync(join(root, 'dist'), before, { recursive: true });
    }

    console.log(C.accent(`\nUpdating the theme to ${target}...`));
    if (pm === 'pnpm') syncAllowBuilds(root, target);
    const spec = `${THEME}@^${target}`;
    run(pm, pm === 'npm' ? ['install', spec] : ['add', spec], root);

    for (const m of migrations) {
      console.log(C.accent(`\nMigration ${m.version}: ${m.description}`));
      await m.run(root);
    }

    // Astro keeps rendered Markdown in its content cache and reuses it for files that haven't
    // changed, even when the theme's Markdown plugins have. Drop it so every page renders with
    // the new theme, here and in the next `pnpm dev`; Astro rebuilds it on the next run.
    rmSync(join(root, 'node_modules', '.astro'), { recursive: true, force: true });

    if (before) {
      console.log(C.accent('\nBuilding the upgraded site...'));
      run(pm, ['run', 'build'], root);
      const diff = compareBuilds(before, join(root, 'dist'));
      const same = diff.total - diff.changed.length - diff.missing.length;
      console.log(C.subtitle(`\nPages: ${same} of ${diff.total} unchanged`));
      for (const p of diff.changed.slice(0, 20)) console.log(C.muted(`  changed  ${p}`));
      for (const p of diff.missing.slice(0, 20)) console.log(C.muted(`  gone     ${p}`));
      for (const p of diff.added.slice(0, 20)) console.log(C.muted(`  new      ${p}`));
      if (diff.changed.length || diff.missing.length) {
        console.log(C.muted('  Changed pages usually come from what the release notes describe; have a look at them before committing.'));
      }
    }

    console.log(C.success(`\n✓ Upgraded to ${target}.`));
    if (isGit) console.log(C.muted(`  Review and commit on ${branch}; to undo, run: git switch - && git branch -D ${branch}`));
  } catch (e) {
    fail(`Upgrade stopped: ${e instanceof Error ? e.message : String(e)}`, isGit ? `Undo with: git checkout . && git switch - && git branch -D ${branch}` : 'Restore package.json and the lockfile from your backup.');
  } finally {
    if (before) rmSync(before, { recursive: true, force: true });
  }
}

/**
 * Before pnpm installs the new version: pnpm 11+ stops on install scripts nobody decided on, so
 * take the decisions that version ships with (its pnpm-workspace.yaml) into the site's file.
 */
function syncAllowBuilds(root: string, version: string): void {
  const block = publishedAllowBuilds(version);
  if (!block) {
    console.log(C.muted('  (Could not read the install-script declarations of the new version; if pnpm stops on ignored builds, declare them in pnpm-workspace.yaml.)'));
    return;
  }
  const file = join(root, 'pnpm-workspace.yaml');
  const { yaml, added } = mergeAllowBuilds(existsSync(file) ? readFileSync(file, 'utf8') : null, block);
  if (!added.length) return;
  writeFileSync(file, yaml);
  console.log(C.muted(`  Declared install scripts in pnpm-workspace.yaml: ${added.join(', ')}`));
}

/** The allowBuilds block in the pnpm-workspace.yaml that a published theme version carries */
function publishedAllowBuilds(version: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'vergil-theme-'));
  try {
    const out = execFileSync('npm', ['pack', `${THEME}@${version}`, '--pack-destination', dir, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const tarball = join(dir, basename(JSON.parse(out)[0].filename));
    execFileSync('tar', ['-xzf', tarball, '-C', dir, 'package/pnpm-workspace.yaml'], { stdio: 'ignore' });
    return allowBuildsBlock(readFileSync(join(dir, 'package', 'pnpm-workspace.yaml'), 'utf8'));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}
