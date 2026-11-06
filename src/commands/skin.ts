import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import inquirer from 'inquirer';
import ora from 'ora';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { canPrompt, fail, warn, NOT_IN_SITE_HINT } from '../utils/output.js';
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
    fail('Not inside a Vergil project', NOT_IN_SITE_HINT);
    return null;
  }
  const contract = readContract(root);
  if (contract === null) {
    fail("This site's Vergil version doesn't support skin packages yet", `The theme has no ${CONTRACT_PATH}. Update the theme first.`);
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
    warn(`Couldn't update ${IDENTITY_PATH} automatically. ${manual}`);
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

async function fetchAndInstall(site: Site, name: string, source: Source, verb: string): Promise<boolean> {
  const spinner = ora(`Fetching ${describeSource(source)}...`).start();
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
      if (taken.has(id)) problems.push(`scheme ID "${id}" is already used by ${taken.get(id)}`);
    }

    if (problems.length) {
      spinner.fail(`${describeSource(source)} is not a usable Vergil skin`);
      for (const problem of problems) console.error(C.error(`  • ${problem}`));
      process.exitCode = 1;
      return false;
    }

    const target = installFiles(site.root, name, staged.dir, scan.files, source);
    spinner.succeed(`${verb} skin ${C.accent(name)} → ${relative(site.root, target)}/ (${scan.files.length} files)`);
    if (scan.skipped.length) {
      const preview = scan.skipped.slice(0, 5).join(', ') + (scan.skipped.length > 5 ? ', ...' : '');
      console.log(C.muted(`  Left out ${scan.skipped.length} file(s) a skin doesn't need: ${preview}`));
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
    fail(`Can't use "${options.name ?? input}" as a skin name`, 'Pass --name <name>: lowercase letters, digits and dashes, starting with a letter');
    return;
  }
  if (name === 'classic') {
    fail('classic is built in and can\'t be replaced', 'Install it under another name with --name');
    return;
  }
  if (existsSync(packageDir(site.root, name)) && !options.force) {
    fail(`${SKINS_DIR}/${name}/ already exists`, `Run vg skin update ${name}, or add --force to replace it`);
    return;
  }

  if (!await fetchAndInstall(site, name, source, 'Installed')) return;

  const manual = `Add '${name}' to skins in ${IDENTITY_PATH}.`;
  if (options.enable === false) {
    console.log(C.muted(`  Not enabled. ${manual}`));
  } else if (editIdentity(site.root, (text) => {
    const list = readNameList(text) ?? [];
    return list.includes(name) ? text : writeNameList(text, [...list, name]);
  }, manual)) {
    console.log(C.success(`✓ Enabled in ${IDENTITY_PATH} (skins)`));
  }
  console.log(C.muted(`  Make it the default for new visitors: vg skin use ${name}`));
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
  console.log(C.title(`Skins  (default: ${defaultSkin})`));
  console.log(`  ${C.success('●')} ${C.text('classic'.padEnd(16))} ${C.muted('built in')}`);

  for (const name of installed) {
    const packagePath = join(site.root, SKINS_DIR, name);
    const manifest = readManifest(packagePath);
    const record = readSourceRecord(packagePath);
    const notes: string[] = [];
    if (manifest?.contract !== site.contract) notes.push(C.error(`targets contract ${JSON.stringify(manifest?.contract)}, site uses ${site.contract}`));
    const schemes = bundledSchemeIds(manifest);
    if (schemes.length) notes.push(`schemes: ${schemes.join(', ')}`);
    notes.push(record ? `from ${describeSource(record.source)}` : 'added by hand');
    const isOn = enabled.includes(name);
    const mark = isOn ? C.success('●') : C.muted('○');
    const state = isOn ? 'enabled' : 'installed, not enabled';
    console.log(`  ${mark} ${C.text(name.padEnd(16))} ${C.muted(state)}  ${C.muted('· ' + notes.join(' · '))}`);
  }
  for (const name of enabled.filter((n) => !installed.includes(n))) {
    console.log(`  ${C.error('✗')} ${C.text(name.padEnd(16))} ${C.error(`enabled but not installed: put it in ${SKINS_DIR}/${name}/ or run vg skin add ${name}`)}`);
  }
  if (!installed.length) console.log(C.muted(`  No skins installed in ${SKINS_DIR}/ yet. Try: vg skin add <name|owner/repo|./folder>`));
  console.log('');
}

// ── use ──────────────────────────────────────────────────────────────────

export async function skinUseCommand(name: string): Promise<void> {
  const site = requireSite();
  if (!site) return;
  if (name !== 'classic') {
    if (!NAME_RE.test(name) || !existsSync(packageDir(site.root, name))) {
      fail(`Skin "${name}" is not installed`, `Install it first: vg skin add ${name}`);
      return;
    }
    const enabled = readNameList(readIdentity(site.root)) ?? [];
    if (!enabled.includes(name)) {
      const ok = editIdentity(site.root, (text) => writeNameList(text, [...(readNameList(text) ?? []), name]),
        `Add '${name}' to skins in ${IDENTITY_PATH}.`);
      if (ok) console.log(C.success(`✓ Enabled ${name} in ${IDENTITY_PATH} (skins)`));
    }
  }
  if (editIdentity(site.root, (text) => writeDefaultSkin(text, name), `Set skin: '${name}' in ${IDENTITY_PATH}.`)) {
    console.log(C.success(`✓ Default skin is now ${C.accent(name)}`));
    console.log(C.muted('  Visitors who already picked a skin keep their choice.'));
  }
}

// ── update ───────────────────────────────────────────────────────────────

export async function skinUpdateCommand(name?: string): Promise<void> {
  const site = requireSite();
  if (!site) return;
  const names = name ? [name] : installedNames(site.root);
  if (!names.length) {
    console.log(C.muted(`No skins installed in ${SKINS_DIR}/.`));
    return;
  }
  for (const n of names) {
    if (!NAME_RE.test(n) || !existsSync(packageDir(site.root, n))) {
      fail(`skin "${n}" is not installed`);
      continue;
    }
    const record = readSourceRecord(packageDir(site.root, n));
    if (!record) {
      warn(`${SKINS_DIR}/${n}/ was added by hand, no source to update from. Skipped.`);
      continue;
    }
    await fetchAndInstall(site, n, record.source, 'Updated');
  }
}

// ── remove ───────────────────────────────────────────────────────────────

export async function skinRemoveCommand(name: string, options: RemoveOptions): Promise<void> {
  const site = requireSite();
  if (!site) return;
  if (name === 'classic') {
    fail('classic is built in and can\'t be removed');
    return;
  }
  if (!NAME_RE.test(name)) {
    fail(`"${name}" is not a valid skin name`);
    return;
  }
  const target = packageDir(site.root, name);
  const identity = readIdentity(site.root);
  const isEnabled = (readNameList(identity) ?? []).includes(name);
  const isInstalled = existsSync(target);
  if (!isInstalled && !isEnabled) {
    fail(`skin "${name}" is not installed`);
    return;
  }

  if (!options.yes) {
    if (!canPrompt) {
      fail('Refusing to delete without confirmation', 'Add --yes to confirm in a non-interactive shell');
      return;
    }
    const what = isInstalled ? `Delete ${SKINS_DIR}/${name}/ and disable it` : `Remove "${name}" from skins`;
    let confirmed = false;
    try {
      ({ confirmed } = await inquirer.prompt([{ type: 'confirm', name: 'confirmed', message: `${what}?`, default: false }]));
    } catch (err) {
      // Ctrl+C or Ctrl+D closes the prompt: that's a "no", not a crash with a stack trace
      if ((err as Error)?.name !== 'ExitPromptError') throw err;
      console.log(C.muted('\nCancelled.'));
    }
    if (!confirmed) return;
  }

  if (isEnabled) {
    editIdentity(site.root, (text) => writeNameList(text, (readNameList(text) ?? []).filter((n) => n !== name)),
      `Remove '${name}' from skins in ${IDENTITY_PATH}.`);
  }
  if (readDefaultSkin(readIdentity(site.root)) === name) {
    if (editIdentity(site.root, (text) => writeDefaultSkin(text, 'classic'), `Set skin: 'classic' in ${IDENTITY_PATH}.`)) {
      console.log(C.muted(`  ${name} was the default skin; the default is now classic.`));
    }
  }
  if (isInstalled) rmSync(target, { recursive: true, force: true });
  console.log(C.success(`✓ Removed skin ${name}`));
}
