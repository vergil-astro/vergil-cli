import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import inquirer from 'inquirer';
import ora from 'ora';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import {
  CONTRACT_PATH, IDENTITY_PATH, KINDS, NAME_RE,
  deriveName, describeSource, installFiles, installedNames, packageDir, parseSource,
  readContract, readDefaultSkin, readManifest, readNameList, readSourceRecord,
  scanFiles, stageSource, validatePackage, writeDefaultSkin, writeNameList,
  type PackageKind, type Source,
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

function fail(message: string, hint?: string): void {
  console.log(C.error(`✗ ${message}`));
  if (hint) console.log(C.muted(`  ${hint}`));
  process.exitCode = 1;
}

function requireSite(): Site | null {
  const root = getProjectRoot();
  if (!root) {
    fail('Not inside a Vergil project');
    return null;
  }
  const contract = readContract(root);
  if (contract === null) {
    fail("This site's Vergil version doesn't support skin and scheme packages yet", `${CONTRACT_PATH} is missing. Sync the theme first.`);
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
    console.log(C.warning(`⚠ Couldn't update ${IDENTITY_PATH} automatically. ${manual}`));
    return false;
  }
  if (next !== text) writeFileSync(file, next);
  return true;
}

function readIdentity(root: string): string {
  const file = join(root, IDENTITY_PATH);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** Scheme IDs already taken by other installed packages, to catch clashes before the build does */
function takenSchemeIds(root: string, except: { kind: PackageKind; name: string }): Map<string, string> {
  const taken = new Map<string, string>();
  for (const kind of ['skin', 'scheme'] as const) {
    for (const name of installedNames(root, kind)) {
      if (kind === except.kind && name === except.name) continue;
      const where = `${KINDS[kind].dir}/${name}`;
      if (kind === 'scheme') taken.set(name, where);
      const manifest = readManifest(join(root, KINDS[kind].dir, name), kind);
      const schemes = kind === 'skin' && Array.isArray(manifest?.schemes) ? manifest.schemes : [];
      for (const s of schemes) if (s && typeof s.id === 'string') taken.set(s.id, where);
    }
  }
  return taken;
}

async function fetchAndInstall(site: Site, kind: PackageKind, name: string, source: Source, verb: string): Promise<boolean> {
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
    const problems = validatePackage(staged.dir, scan.files, kind, site.contract);

    const manifest = readManifest(staged.dir, kind);
    const ownIds = kind === 'scheme'
      ? [name]
      : (Array.isArray(manifest?.schemes) ? manifest.schemes : []).map((s: { id?: unknown }) => s?.id).filter((id: unknown): id is string => typeof id === 'string');
    const taken = takenSchemeIds(site.root, { kind, name });
    for (const id of ownIds) {
      if (taken.has(id)) problems.push(`scheme ID "${id}" is already used by ${taken.get(id)}`);
    }

    if (problems.length) {
      spinner.fail(`${describeSource(source)} is not a usable Vergil ${kind}`);
      for (const problem of problems) console.log(C.error(`  • ${problem}`));
      process.exitCode = 1;
      return false;
    }

    const target = installFiles(site.root, kind, name, staged.dir, scan.files, source);
    spinner.succeed(`${verb} ${kind} ${C.accent(name)} → ${relative(site.root, target)}/ (${scan.files.length} files)`);
    if (scan.skipped.length) {
      const preview = scan.skipped.slice(0, 5).join(', ') + (scan.skipped.length > 5 ? ', ...' : '');
      console.log(C.muted(`  Left out ${scan.skipped.length} file(s) a ${kind} doesn't need: ${preview}`));
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

export function addCommand(kind: PackageKind) {
  return async (input: string, options: AddOptions): Promise<void> => {
    const site = requireSite();
    if (!site) return;
    const { dir, field } = KINDS[kind];

    let source: Source;
    try {
      source = parseSource(input, kind);
    } catch (error) {
      fail((error as Error).message);
      return;
    }

    const name = options.name ?? deriveName(source, kind);
    if (!name || !NAME_RE.test(name)) {
      fail(`Can't use "${options.name ?? input}" as a ${kind} name`, 'Pass --name <name>: lowercase letters, digits and dashes, starting with a letter');
      return;
    }
    if (kind === 'skin' && name === 'classic') {
      fail('classic is built in and can\'t be replaced', 'Install it under another name with --name');
      return;
    }
    if (existsSync(packageDir(site.root, kind, name)) && !options.force) {
      fail(`${dir}/${name}/ already exists`, `Run vg ${kind} update ${name}, or add --force to replace it`);
      return;
    }

    if (!await fetchAndInstall(site, kind, name, source, 'Installed')) return;

    const manual = `Add '${name}' to ${field} in ${IDENTITY_PATH}.`;
    if (options.enable === false) {
      console.log(C.muted(`  Not enabled. ${manual}`));
    } else if (editIdentity(site.root, (text) => {
      const list = readNameList(text, field) ?? [];
      return list.includes(name) ? text : writeNameList(text, field, [...list, name]);
    }, manual)) {
      console.log(C.success(`✓ Enabled in ${IDENTITY_PATH} (${field})`));
    }
    if (kind === 'skin') console.log(C.muted(`  Make it the default for new visitors: vg skin use ${name}`));
  };
}

// ── list ─────────────────────────────────────────────────────────────────

export function listCommand(kind: PackageKind) {
  return (): void => {
    const site = requireSite();
    if (!site) return;
    const { dir, field } = KINDS[kind];
    const identity = readIdentity(site.root);
    const enabled = readNameList(identity, field) ?? [];
    const installed = installedNames(site.root, kind);
    const defaultSkin = kind === 'skin' ? readDefaultSkin(identity) ?? 'classic' : null;

    console.log('');
    console.log(C.title(kind === 'skin' ? `Skins  (default: ${defaultSkin})` : 'Color schemes'));
    if (kind === 'skin') {
      console.log(`  ${C.success('●')} ${C.text('classic'.padEnd(16))} ${C.muted('built in')}`);
    } else {
      console.log(`  ${C.success('●')} ${C.text('A–I, K'.padEnd(16))} ${C.muted('built in')}`);
    }

    for (const name of installed) {
      const packagePath = join(site.root, dir, name);
      const manifest = readManifest(packagePath, kind);
      const record = readSourceRecord(packagePath);
      const notes: string[] = [];
      if (manifest?.contract !== site.contract) notes.push(C.error(`targets contract ${JSON.stringify(manifest?.contract)}, site uses ${site.contract}`));
      if (kind === 'skin' && Array.isArray(manifest?.schemes) && manifest.schemes.length) {
        notes.push(`schemes: ${manifest.schemes.map((s: { id?: unknown }) => s?.id).join(', ')}`);
      }
      notes.push(record ? `from ${describeSource(record.source)}` : 'added by hand');
      const isOn = enabled.includes(name);
      const mark = isOn ? C.success('●') : C.muted('○');
      const state = isOn ? 'enabled' : 'installed, not enabled';
      console.log(`  ${mark} ${C.text(name.padEnd(16))} ${C.muted(state)}  ${C.muted('· ' + notes.join(' · '))}`);
    }
    for (const name of enabled.filter((n) => !installed.includes(n))) {
      console.log(`  ${C.error('✗')} ${C.text(name.padEnd(16))} ${C.error(`enabled but not installed: put it in ${dir}/${name}/ or run vg ${kind} add ${name}`)}`);
    }
    if (!installed.length) console.log(C.muted(`  No ${kind}s installed in ${dir}/ yet. Try: vg ${kind} add <name|owner/repo|./folder>`));
    console.log('');
  };
}

// ── use ──────────────────────────────────────────────────────────────────

export async function skinUseCommand(name: string): Promise<void> {
  const site = requireSite();
  if (!site) return;
  if (name !== 'classic') {
    if (!NAME_RE.test(name) || !existsSync(packageDir(site.root, 'skin', name))) {
      fail(`Skin "${name}" is not installed`, `Install it first: vg skin add ${name}`);
      return;
    }
    const enabled = readNameList(readIdentity(site.root), 'skins') ?? [];
    if (!enabled.includes(name)) {
      const ok = editIdentity(site.root, (text) => writeNameList(text, 'skins', [...(readNameList(text, 'skins') ?? []), name]),
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

export function updateCommand(kind: PackageKind) {
  return async (name?: string): Promise<void> => {
    const site = requireSite();
    if (!site) return;
    const { dir } = KINDS[kind];
    const names = name ? [name] : installedNames(site.root, kind);
    if (!names.length) {
      console.log(C.muted(`No ${kind}s installed in ${dir}/.`));
      return;
    }
    for (const n of names) {
      if (!NAME_RE.test(n) || !existsSync(packageDir(site.root, kind, n))) {
        fail(`${kind} "${n}" is not installed`);
        continue;
      }
      const record = readSourceRecord(packageDir(site.root, kind, n));
      if (!record) {
        console.log(C.warning(`⚠ ${dir}/${n}/ was added by hand, no source to update from. Skipped.`));
        continue;
      }
      await fetchAndInstall(site, kind, n, record.source, 'Updated');
    }
  };
}

// ── remove ───────────────────────────────────────────────────────────────

export function removeCommand(kind: PackageKind) {
  return async (name: string, options: RemoveOptions): Promise<void> => {
    const site = requireSite();
    if (!site) return;
    const { dir, field } = KINDS[kind];
    if (kind === 'skin' && name === 'classic') {
      fail('classic is built in and can\'t be removed');
      return;
    }
    if (!NAME_RE.test(name)) {
      fail(`"${name}" is not a valid ${kind} name`);
      return;
    }
    const target = packageDir(site.root, kind, name);
    const identity = readIdentity(site.root);
    const isEnabled = (readNameList(identity, field) ?? []).includes(name);
    const isInstalled = existsSync(target);
    if (!isInstalled && !isEnabled) {
      fail(`${kind} "${name}" is not installed`);
      return;
    }

    if (!options.yes) {
      if (!process.stdin.isTTY) {
        fail('Refusing to delete without confirmation', 'Add --yes to confirm in a non-interactive shell');
        return;
      }
      const what = isInstalled ? `Delete ${dir}/${name}/ and disable it` : `Remove "${name}" from ${field}`;
      const { confirmed } = await inquirer.prompt([{ type: 'confirm', name: 'confirmed', message: `${what}?`, default: false }]);
      if (!confirmed) return;
    }

    if (isEnabled) {
      editIdentity(site.root, (text) => writeNameList(text, field, (readNameList(text, field) ?? []).filter((n) => n !== name)),
        `Remove '${name}' from ${field} in ${IDENTITY_PATH}.`);
    }
    if (kind === 'skin' && readDefaultSkin(readIdentity(site.root)) === name) {
      if (editIdentity(site.root, (text) => writeDefaultSkin(text, 'classic'), `Set skin: 'classic' in ${IDENTITY_PATH}.`)) {
        console.log(C.muted(`  ${name} was the default skin; the default is now classic.`));
      }
    }
    if (isInstalled) rmSync(target, { recursive: true, force: true });
    console.log(C.success(`✓ Removed ${kind} ${name}`));
  };
}
