import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { MIGRATIONS } from '../migrations/index.js';
import { compareBuilds } from '../utils/compare-build.js';
import { getProjectRoot } from '../utils/file.js';
import { C } from '../utils/helpers.js';
import { fail, failNotInSite } from '../utils/output.js';
import { t } from '../utils/i18n.js';
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
  if (!root) return failNotInSite();

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!pkg.dependencies?.[THEME] && !pkg.devDependencies?.[THEME]) {
    return fail(t('upgrade.carriesSource'), t('upgrade.carriesSourceHint'));
  }

  const installedFile = join(root, 'node_modules', '@vergil-astro', 'theme', 'package.json');
  if (!existsSync(installedFile)) return fail(t('upgrade.notInstalled'), t('upgrade.notInstalledHint'));
  const current: string = JSON.parse(readFileSync(installedFile, 'utf8')).version;

  let target = options.to?.replace(/^v/, '');
  if (!target) {
    try {
      target = execFileSync('npm', ['view', THEME, 'version'], { encoding: 'utf8' }).trim();
    } catch {
      return fail(t('upgrade.lookupFailed'), t('upgrade.lookupFailedHint'));
    }
  }
  if (!parseVersion(target)) return fail(t('upgrade.notVersion', { version: target }));
  if (compareVersions(target, current) <= 0) {
    console.log(C.success(t('upgrade.upToDate', { version: current })));
    return;
  }

  const migrations = inRange(MIGRATIONS, current, target);
  const pm = detectPackageManager(root);
  const isGit = existsSync(join(root, '.git'));
  const branch = `vergil-upgrade/${target}`;

  console.log(C.subtitle(t('upgrade.plan', { from: current, to: target })));
  if (isGit) console.log(C.muted(`  ${t('upgrade.stepBranch', { branch })}`));
  if (!options.skipCheck) console.log(C.muted(`  ${t('upgrade.stepBuildBefore')}`));
  console.log(C.muted(`  ${t('upgrade.stepUpdate', { pm })}`));
  if (pm === 'pnpm') console.log(C.muted(`       ${t('upgrade.stepAllowBuilds')}`));
  console.log(C.muted(`  ${migrations.length ? t('upgrade.stepMigrations', { count: migrations.length }) : t('upgrade.stepNoMigrations')}`));
  for (const m of migrations) console.log(C.muted(`       ${m.version}  ${t(m.description)}`));
  console.log(C.muted(`     ${t('upgrade.stepClearCache')}`));
  if (!options.skipCheck) console.log(C.muted(`  ${t('upgrade.stepCompare')}`));
  if (options.dryRun) {
    console.log(C.muted(`\n${t('upgrade.dryRun')}`));
    return;
  }

  if (isGit) {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
    if (dirty) return fail(t('upgrade.dirty'), t('upgrade.dirtyHint'));
    try {
      execFileSync('git', ['switch', '-c', branch], { cwd: root, stdio: 'ignore' });
    } catch {
      return fail(t('upgrade.branchFailed', { branch }), t('upgrade.branchFailedHint'));
    }
  } else {
    console.log(C.warning(t('upgrade.notGit')));
  }

  let before: string | null = null;
  try {
    if (!options.skipCheck) {
      console.log(C.accent(`\n${t('upgrade.buildingCurrent')}`));
      run(pm, ['run', 'build'], root);
      before = mkdtempSync(join(tmpdir(), 'vergil-upgrade-'));
      cpSync(join(root, 'dist'), before, { recursive: true });
    }

    console.log(C.accent(`\n${t('upgrade.updating', { version: target })}`));
    if (pm === 'pnpm') syncAllowBuilds(root, target);
    const spec = `${THEME}@^${target}`;
    run(pm, pm === 'npm' ? ['install', spec] : ['add', spec], root);

    for (const m of migrations) {
      console.log(C.accent(`\n${t('upgrade.migration', { version: m.version, description: t(m.description) })}`));
      await m.run(root);
    }

    // Astro keeps rendered Markdown in its content cache and reuses it for files that haven't
    // changed, even when the theme's Markdown plugins have. Drop it so every page renders with
    // the new theme, here and in the next `pnpm dev`; Astro rebuilds it on the next run.
    rmSync(join(root, 'node_modules', '.astro'), { recursive: true, force: true });

    if (before) {
      console.log(C.accent(`\n${t('upgrade.buildingUpgraded')}`));
      run(pm, ['run', 'build'], root);
      const diff = compareBuilds(before, join(root, 'dist'));
      const same = diff.total - diff.changed.length - diff.missing.length;
      console.log(C.subtitle(`\n${t('upgrade.pagesSame', { same, total: diff.total })}`));
      for (const page of diff.changed.slice(0, 20)) console.log(C.muted(`  ${t('upgrade.pageChanged', { page })}`));
      for (const page of diff.missing.slice(0, 20)) console.log(C.muted(`  ${t('upgrade.pageGone', { page })}`));
      for (const page of diff.added.slice(0, 20)) console.log(C.muted(`  ${t('upgrade.pageNew', { page })}`));
      if (diff.changed.length || diff.missing.length) {
        console.log(C.muted(`  ${t('upgrade.changedNote')}`));
      }
    }

    console.log(C.success(`\n${t('upgrade.done', { version: target })}`));
    if (isGit) console.log(C.muted(`  ${t('upgrade.reviewHint', { branch })}`));
  } catch (e) {
    fail(t('upgrade.stopped', { error: e instanceof Error ? e.message : String(e) }), isGit ? t('upgrade.undoGit', { branch }) : t('upgrade.undoNoGit'));
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
    console.log(C.muted(`  ${t('upgrade.allowBuildsUnknown')}`));
    return;
  }
  const file = join(root, 'pnpm-workspace.yaml');
  const { yaml, added } = mergeAllowBuilds(existsSync(file) ? readFileSync(file, 'utf8') : null, block);
  if (!added.length) return;
  writeFileSync(file, yaml);
  console.log(C.muted(`  ${t('upgrade.allowBuildsAdded', { list: added.join(', ') })}`));
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
