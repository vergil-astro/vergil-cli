import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import inquirer from 'inquirer';
import ora from 'ora';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { canPrompt, fail, notInSiteHint, warn } from '../utils/output.js';
import { t } from '../utils/i18n.js';
import {
  CONTRACT_PATH, IDENTITY_PATH, NAME_RE, SKINS_DIR,
  deriveName, describeSource, installFiles, installedNames, packageDir, parseSource,
  readContract, readDefaultSkin, readManifest, readNameList, readSourceRecord,
  scanFiles, stageSource, validatePackage, writeDefaultSkin, writeNameList,
  type Source,
} from '../utils/appearance.js';

interface AddOptions {
  name?: string;
  force?: boolean;
  /** commander turns --no-enable into enable: false */
  enable?: boolean;
}

interface RemoveOptions {
  yes?: boolean;
}

interface Site {
  root: string;
  contract: number;
}

function requireSite(): Site | null {
  const root = getProjectRoot();
  if (!root) {
    fail(t('skin.notInProject'), notInSiteHint());
    return null;
  }
  const contract = readContract(root);
  if (contract === null) {
    fail(t('skin.noContract'), t('skin.noContractHint', { path: CONTRACT_PATH }));
    return null;
  }
  return { root, contract };
}

/** Apply an edit to identity.ts; when it can't be done automatically, say what to change by hand */
function editIdentity(root: string, edit: (text: string) => string | null, manual: string): boolean {
  const file = join(root, IDENTITY_PATH);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const next = text === null ? null : edit(text);
  if (next === null) {
    warn(t('skin.identityManual', { path: IDENTITY_PATH, manual }));
    return false;
  }
  if (next !== text) writeFileSync(file, next);
  return true;
}

function readIdentity(root: string): string {
  const file = join(root, IDENTITY_PATH);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** IDs of the schemes a skin bundles */
function bundledSchemeIds(manifest: Record<string, unknown> | null): string[] {
  const schemes = Array.isArray(manifest?.schemes) ? manifest.schemes : [];
  return schemes.map((s: { id?: unknown }) => s?.id).filter((id: unknown): id is string => typeof id === 'string');
}

/** Scheme IDs bundled by the other installed skins, to catch clashes before the build does */
function takenSchemeIds(root: string, except: string): Map<string, string> {
  const taken = new Map<string, string>();
  for (const name of installedNames(root)) {
    if (name === except) continue;
    for (const id of bundledSchemeIds(readManifest(join(root, SKINS_DIR, name)))) taken.set(id, `${SKINS_DIR}/${name}`);
  }
  return taken;
}

async function fetchAndInstall(site: Site, name: string, source: Source, mode: 'install' | 'update'): Promise<boolean> {
  const spinner = ora(t('skin.fetching', { source: describeSource(source) })).start();
  let staged;
  try {
    staged = await stageSource(source);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exitCode = 1;
    return false;
  }
  try {
    const scan = scanFiles(staged.dir);
    const problems = validatePackage(staged.dir, scan.files, site.contract);

    const taken = takenSchemeIds(site.root, name);
    for (const id of bundledSchemeIds(readManifest(staged.dir))) {
      if (taken.has(id)) problems.push(t('skin.schemeTaken', { id, by: String(taken.get(id)) }));
    }

    if (problems.length) {
      spinner.fail(t('skin.notUsable', { source: describeSource(source) }));
      for (const problem of problems) console.error(C.error(`  • ${problem}`));
      process.exitCode = 1;
      return false;
    }

    const target = installFiles(site.root, name, staged.dir, scan.files, source);
    const done = { name: C.accent(name), path: relative(site.root, target), files: t('skin.files', { count: scan.files.length }) };
    spinner.succeed(t(mode === 'install' ? 'skin.installedDone' : 'skin.updatedDone', done));
    if (scan.skipped.length) {
      const preview = scan.skipped.slice(0, 5).join(', ') + (scan.skipped.length > 5 ? ', ...' : '');
      console.log(C.muted(`  ${t('skin.leftOut', { count: scan.skipped.length, preview })}`));
    }
    return true;
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exitCode = 1;
    return false;
  } finally {
    staged.cleanup();
  }
}

// ── add ──────────────────────────────────────────────────────────────────

export async function skinAddCommand(input: string, options: AddOptions): Promise<void> {
  const site = requireSite();
  if (!site) return;

  let source: Source;
  try {
    source = parseSource(input);
  } catch (error) {
    fail((error as Error).message);
    return;
  }

  const name = options.name ?? deriveName(source);
  if (!name || !NAME_RE.test(name)) {
    fail(t('skin.badName', { name: options.name ?? input }), t('skin.badNameHint'));
    return;
  }
  if (name === 'classic') {
    fail(t('skin.classicReplace'), t('skin.classicReplaceHint'));
    return;
  }
  if (existsSync(packageDir(site.root, name)) && !options.force) {
    fail(t('skin.exists', { path: `${SKINS_DIR}/${name}` }), t('skin.existsHint', { name }));
    return;
  }

  if (!await fetchAndInstall(site, name, source, 'install')) return;

  const manual = t('skin.manualAdd', { name, path: IDENTITY_PATH });
  if (options.enable === false) {
    console.log(C.muted(`  ${t('skin.notEnabled', { manual })}`));
  } else if (editIdentity(site.root, (text) => {
    const list = readNameList(text) ?? [];
    return list.includes(name) ? text : writeNameList(text, [...list, name]);
  }, manual)) {
    console.log(C.success(t('skin.enabledIn', { path: IDENTITY_PATH })));
  }
  console.log(C.muted(`  ${t('skin.makeDefault', { name })}`));
}

// ── list ─────────────────────────────────────────────────────────────────

export function skinListCommand(): void {
  const site = requireSite();
  if (!site) return;
  const identity = readIdentity(site.root);
  const enabled = readNameList(identity) ?? [];
  const installed = installedNames(site.root);
  const defaultSkin = readDefaultSkin(identity) ?? 'classic';

  console.log('');
  console.log(C.title(t('skin.listTitle', { name: defaultSkin })));
  console.log(`  ${C.success('●')} ${C.text('classic'.padEnd(16))} ${C.muted(t('skin.builtIn'))}`);

  for (const name of installed) {
    const packagePath = join(site.root, SKINS_DIR, name);
    const manifest = readManifest(packagePath);
    const record = readSourceRecord(packagePath);
    const notes: string[] = [];
    if (manifest?.contract !== site.contract) notes.push(C.error(t('skin.contractMismatch', { target: String(JSON.stringify(manifest?.contract)), site: site.contract })));
    const schemes = bundledSchemeIds(manifest);
    if (schemes.length) notes.push(t('skin.schemes', { list: schemes.join(', ') }));
    notes.push(record ? t('skin.from', { source: describeSource(record.source) }) : t('skin.byHand'));
    const isOn = enabled.includes(name);
    const mark = isOn ? C.success('●') : C.muted('○');
    const state = t(isOn ? 'skin.enabled' : 'skin.installedNotEnabled');
    console.log(`  ${mark} ${C.text(name.padEnd(16))} ${C.muted(state)}  ${C.muted('· ' + notes.join(' · '))}`);
  }
  for (const name of enabled.filter((n) => !installed.includes(n))) {
    console.log(`  ${C.error('✗')} ${C.text(name.padEnd(16))} ${C.error(t('skin.enabledNotInstalled', { path: `${SKINS_DIR}/${name}`, name }))}`);
  }
  if (!installed.length) console.log(C.muted(`  ${t('skin.noneInstalled', { dir: SKINS_DIR })}`));
  console.log('');
}

// ── use ──────────────────────────────────────────────────────────────────

export async function skinUseCommand(name: string): Promise<void> {
  const site = requireSite();
  if (!site) return;
  if (name !== 'classic') {
    if (!NAME_RE.test(name) || !existsSync(packageDir(site.root, name))) {
      fail(t('skin.notInstalled', { name }), t('skin.installFirst', { name }));
      return;
    }
    const enabled = readNameList(readIdentity(site.root)) ?? [];
    if (!enabled.includes(name)) {
      const ok = editIdentity(site.root, (text) => writeNameList(text, [...(readNameList(text) ?? []), name]),
        t('skin.manualAdd', { name, path: IDENTITY_PATH }));
      if (ok) console.log(C.success(t('skin.enabledName', { name, path: IDENTITY_PATH })));
    }
  }
  if (editIdentity(site.root, (text) => writeDefaultSkin(text, name), t('skin.manualDefault', { name, path: IDENTITY_PATH }))) {
    console.log(C.success(t('skin.defaultNow', { name: C.accent(name) })));
    console.log(C.muted(`  ${t('skin.keepChoice')}`));
  }
}

// ── update ───────────────────────────────────────────────────────────────

export async function skinUpdateCommand(name?: string): Promise<void> {
  const site = requireSite();
  if (!site) return;
  const names = name ? [name] : installedNames(site.root);
  if (!names.length) {
    console.log(C.muted(t('skin.noneToUpdate', { dir: SKINS_DIR })));
    return;
  }
  for (const n of names) {
    if (!NAME_RE.test(n) || !existsSync(packageDir(site.root, n))) {
      fail(t('skin.notInstalled', { name: n }));
      continue;
    }
    const record = readSourceRecord(packageDir(site.root, n));
    if (!record) {
      warn(t('skin.byHandSkip', { path: `${SKINS_DIR}/${n}` }));
      continue;
    }
    await fetchAndInstall(site, n, record.source, 'update');
  }
}

// ── remove ───────────────────────────────────────────────────────────────

export async function skinRemoveCommand(name: string, options: RemoveOptions): Promise<void> {
  const site = requireSite();
  if (!site) return;
  if (name === 'classic') {
    fail(t('skin.classicRemove'));
    return;
  }
  if (!NAME_RE.test(name)) {
    fail(t('skin.invalidName', { name }));
    return;
  }
  const target = packageDir(site.root, name);
  const identity = readIdentity(site.root);
  const isEnabled = (readNameList(identity) ?? []).includes(name);
  const isInstalled = existsSync(target);
  if (!isInstalled && !isEnabled) {
    fail(t('skin.notInstalled', { name }));
    return;
  }

  if (!options.yes) {
    if (!canPrompt) {
      fail(t('skin.refuseNoConfirm'), t('skin.refuseHint'));
      return;
    }
    const message = isInstalled ? t('skin.confirmDelete', { path: `${SKINS_DIR}/${name}` }) : t('skin.confirmRemove', { name });
    let confirmed = false;
    try {
      ({ confirmed } = await inquirer.prompt([{ type: 'confirm', name: 'confirmed', message, default: false }]));
    } catch (err) {
      // Ctrl+C or Ctrl+D closes the prompt: that's a "no", not a crash with a stack trace
      if ((err as Error)?.name !== 'ExitPromptError') throw err;
      console.log(C.muted(`\n${t('common.cancelled')}`));
    }
    if (!confirmed) return;
  }

  if (isEnabled) {
    editIdentity(site.root, (text) => writeNameList(text, (readNameList(text) ?? []).filter((n) => n !== name)),
      t('skin.manualRemove', { name, path: IDENTITY_PATH }));
  }
  if (readDefaultSkin(readIdentity(site.root)) === name) {
    if (editIdentity(site.root, (text) => writeDefaultSkin(text, 'classic'), t('skin.manualDefault', { name: 'classic', path: IDENTITY_PATH }))) {
      console.log(C.muted(`  ${t('skin.wasDefault', { name })}`));
    }
  }
  if (isInstalled) rmSync(target, { recursive: true, force: true });
  console.log(C.success(t('skin.removed', { name })));
}
