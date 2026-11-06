/**
 * Logic behind `vg skin`.
 *
 * A Vergil site loads skins by convention: a skin lives in `skins/<name>/` at the site
 * root and is enabled by listing its name in `src/data/config/identity.ts`. Every skin
 * bundles at least one color scheme, and visitors can only pick a skin's own schemes
 * (the built-in A–I and K belong to the classic skin); there are no standalone scheme
 * packages. These helpers fetch a skin, keep only the files a skin is allowed to contain,
 * validate its manifest against the site's appearance contract, and edit identity.ts.
 *
 * Skins are data + CSS only. The theme never executes anything from them, and the
 * installer never copies scripts into the site.
 */
import { execFile } from 'child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { promisify } from 'util';
import { resolveThemeFile } from './theme.js';

const execFileAsync = promisify(execFile);

/** Folder at the site root */
export const SKINS_DIR = 'skins';
/** Manifest file inside a skin */
export const MANIFEST = 'skin.json';
/** CSS entry inside a skin */
const ENTRY = 'skin.css';
/** Standalone skin repos are usually named vergil-skin-<name>; the prefix is dropped from the install name */
const REPO_PREFIX = 'vergil-skin-';

/** Same rule as the theme: names end up in paths, CSS selectors and HTML attributes */
export const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SHORT_RE = /^[A-Za-z0-9]{1,2}$/;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))$/;
const GITHUB_PART_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;

/** Official and contributed skins live together in vergil-astro/vergil-skins, one folder each under skins/ */
export const OFFICIAL_OWNER = 'vergil-astro';
export const OFFICIAL_REPO = 'vergil-skins';
const OFFICIAL_PATH = 'skins';
/** Folder depth limit for owner/repo/path sources */
const MAX_PATH_PARTS = 10;
/** Where the installer records the source, so `update` knows where to fetch from */
export const SOURCE_FILE = '.vg-source.json';
export const IDENTITY_PATH = join('src', 'data', 'config', 'identity.ts');
/** The appearance contract inside the theme (relative to the theme's src/, see resolveThemeFile) */
export const CONTRACT_PATH = 'appearance/contract.json';

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 500;

/** Files a package may contain; everything else is left out on install */
const ALLOWED_EXT = new Set([
  '.json', '.css', '.md', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg',
  '.woff', '.woff2', '.ttf', '.otf',
]);
const ALLOWED_BARE = /^(LICEN[CS]E|NOTICE|COPYING)$/i;
const SKIPPED_DIRS = new Set(['node_modules']);

// ── Sources ──────────────────────────────────────────────────────────────

export type Source =
  | { type: 'local'; path: string }
  | { type: 'github'; owner: string; repo: string; path?: string; ref?: string };

/**
 * `island`                  → skins/island in vergil-astro/vergil-skins
 * `owner/repo[#ref]`        → a GitHub repo that is one skin, optionally at a tag/branch/commit
 * `owner/repo/path[#ref]`   → a skin in a folder of a GitHub repo
 * `./dir`, `/abs/dir`       → a local folder
 */
export function parseSource(input: string, cwd: string = process.cwd()): Source {
  const value = input.trim();
  if (!value) throw new Error('Missing skin source');

  if (value.startsWith('.') || value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value)) {
    const path = value.startsWith('~') ? join(homedir(), value.slice(1)) : resolve(cwd, value);
    return { type: 'local', path };
  }

  const hash = value.indexOf('#');
  const spec = hash === -1 ? value : value.slice(0, hash);
  const ref = hash === -1 ? undefined : value.slice(hash + 1);
  if (ref !== undefined && (!REF_RE.test(ref) || ref.split('/').includes('..'))) {
    throw new Error(`"${ref}" is not a valid git ref`);
  }

  const parts = spec.split('/');
  if (parts.length === 1) {
    if (!NAME_RE.test(spec)) {
      throw new Error(`"${spec}" is not a valid skin name: use lowercase letters, digits and dashes, starting with a letter`);
    }
    return { type: 'github', owner: OFFICIAL_OWNER, repo: OFFICIAL_REPO, path: `${OFFICIAL_PATH}/${spec}`, ref };
  }
  if (parts.length >= 2 && parts.length <= 2 + MAX_PATH_PARTS && parts.every((p) => GITHUB_PART_RE.test(p) && p !== '.' && p !== '..')) {
    const [owner, repo, ...rest] = parts;
    return rest.length ? { type: 'github', owner, repo, path: rest.join('/'), ref } : { type: 'github', owner, repo, ref };
  }
  throw new Error(
    `Can't read "${input}" as a skin source. Use a name (island), a GitHub repo (owner/repo, owner/repo/folder, either with #tag), or a local folder (./my-skin)`,
  );
}

export function describeSource(source: Source): string {
  return source.type === 'local'
    ? source.path
    : `${source.owner}/${source.repo}${source.path ? `/${source.path}` : ''}${source.ref ? `#${source.ref}` : ''}`;
}

/** Default install name: the folder name, or the repo name minus the vergil-skin- prefix */
export function deriveName(source: Source): string | null {
  let base = source.type === 'local'
    ? basename(source.path)
    : source.path ? source.path.split('/').pop()! : source.repo;
  if (base.startsWith(REPO_PREFIX)) base = base.slice(REPO_PREFIX.length);
  base = base.toLowerCase();
  return NAME_RE.test(base) ? base : null;
}

// ── Fetching ─────────────────────────────────────────────────────────────

export interface Staged {
  /** Folder holding the package files */
  dir: string;
  cleanup: () => void;
}

/** Make the package available in a local folder: local sources are read in place, GitHub sources are downloaded */
export async function stageSource(source: Source): Promise<Staged> {
  const tmp = mkdtempSync(join(tmpdir(), 'vg-pkg-'));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  try {
    if (source.type === 'local') {
      if (!existsSync(source.path) || !statSync(source.path).isDirectory()) {
        throw new Error(`${source.path} is not a folder`);
      }
      return { dir: realpathSync(source.path), cleanup };
    }

    const url = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${source.ref ?? 'HEAD'}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(res.status === 404
        ? `GitHub repo ${source.owner}/${source.repo}${source.ref ? `#${source.ref}` : ''} not found, or that ref doesn't exist`
        : `Download failed: HTTP ${res.status} ${url}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_ARCHIVE_BYTES) throw new Error('Archive is larger than 20 MB, refusing to install');
    const archive = join(tmp, 'package.tar.gz');
    writeFileSync(archive, data);

    // Inspect before extracting: no absolute paths, no "..", no links (a link could redirect later writes)
    const { stdout } = await execFileAsync('tar', ['-tvzf', archive], { maxBuffer: 16 * 1024 * 1024 });
    const { stdout: names } = await execFileAsync('tar', ['-tzf', archive], { maxBuffer: 16 * 1024 * 1024 });
    for (const line of stdout.split('\n').filter(Boolean)) {
      if (line[0] === 'l' || line[0] === 'h') throw new Error('Archive contains links, refusing to install');
    }
    for (const name of names.split('\n').filter(Boolean)) {
      if (isAbsolute(name) || name.split('/').includes('..')) throw new Error(`Archive contains an unsafe path: ${name}`);
    }

    const out = join(tmp, 'package');
    mkdirSync(out);
    await execFileAsync('tar', ['-xzf', archive, '-C', out, '--strip-components=1']);
    if (!source.path) return { dir: out, cleanup };

    // Path parts were checked in parseSource and the archive has no links, so this stays inside `out`
    const dir = join(out, ...source.path.split('/'));
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      const official = source.owner === OFFICIAL_OWNER && source.repo === OFFICIAL_REPO && source.path.startsWith(`${OFFICIAL_PATH}/`);
      throw new Error(official
        ? `There's no skin named "${basename(source.path)}" in ${OFFICIAL_OWNER}/${OFFICIAL_REPO}`
        : `${describeSource(source)}: that folder doesn't exist in the repo`);
    }
    return { dir, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

// ── Files ────────────────────────────────────────────────────────────────

export interface FileScan {
  /** Allowed files, relative paths with forward slashes */
  files: string[];
  /** Left out: scripts, configs, dotfiles, links */
  skipped: string[];
}

export function isAllowedFile(relativePath: string): boolean {
  const name = relativePath.split('/').pop() ?? '';
  return ALLOWED_EXT.has(extname(name).toLowerCase()) || ALLOWED_BARE.test(name);
}

export function scanFiles(dir: string): FileScan {
  const files: string[] = [];
  const skipped: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const rel = relative(dir, full).split(sep).join('/');
      if (entry.startsWith('.') || SKIPPED_DIRS.has(entry)) {
        skipped.push(rel);
        continue;
      }
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) skipped.push(rel);
      else if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && isAllowedFile(rel)) files.push(rel);
      else skipped.push(rel);
      if (files.length > MAX_FILES) throw new Error(`Package has more than ${MAX_FILES} files, refusing to install`);
    }
  };
  walk(dir);
  return { files: files.sort(), skipped: skipped.sort() };
}

// ── Manifest ─────────────────────────────────────────────────────────────

/** Problems that would make the site build fail; the theme checks the same things at build time */
export function validatePackage(dir: string, files: string[], contract: number): string[] {
  const manifest = MANIFEST;
  const problems: string[] = [];
  if (!files.includes(manifest)) return [`missing ${manifest}`];
  if (!files.includes(ENTRY)) problems.push(`missing ${ENTRY}`);

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(join(dir, manifest), 'utf8'));
  } catch (error) {
    return [...problems, `${manifest} is not valid JSON: ${(error as Error).message}`];
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [...problems, `${manifest} should be an object`];
  const m = data as Record<string, unknown>;

  if (m.contract !== contract) {
    problems.push(`${manifest} targets appearance contract ${JSON.stringify(m.contract)}, this site uses ${contract}`);
  }

  const checkScheme = (scheme: Record<string, unknown>, at: string) => {
    if (typeof scheme.short !== 'string' || !SHORT_RE.test(scheme.short)) problems.push(`${at}: short should be 1-2 letters or digits`);
    if (typeof scheme.swatch !== 'string' || !COLOR_RE.test(scheme.swatch)) problems.push(`${at}: swatch should be a hex color or a CSS variable`);
    if (scheme.icon !== undefined && (typeof scheme.icon !== 'string' || !COLOR_RE.test(scheme.icon))) {
      problems.push(`${at}: icon should be a hex color or a CSS variable`);
    }
  };

  // Visitors can only pick a skin's own schemes, so a skin needs at least one
  const ids: string[] = [];
  const shorts: unknown[] = [];
  if (!Array.isArray(m.schemes) || !m.schemes.length) {
    problems.push(`${manifest}: schemes needs at least one color scheme; visitors can only pick a skin's own schemes`);
  } else {
    m.schemes.forEach((raw: unknown, i: number) => {
      const at = `${manifest} schemes[${i}]`;
      if (!raw || typeof raw !== 'object') {
        problems.push(`${at} should be an object`);
        return;
      }
      const scheme = raw as Record<string, unknown>;
      if (typeof scheme.id !== 'string' || !NAME_RE.test(scheme.id)) {
        problems.push(`${at}: id is not a valid name`);
        return;
      }
      checkScheme(scheme, at);
      if (shorts.includes(scheme.short)) problems.push(`${at}: short "${scheme.short}" is already used by another scheme in this skin`);
      shorts.push(scheme.short);
      ids.push(scheme.id);
      if (!files.includes(`schemes/${scheme.id}.css`)) problems.push(`missing schemes/${scheme.id}.css`);
    });
  }
  if (m.recommendedScheme !== undefined && (typeof m.recommendedScheme !== 'string' || !ids.includes(m.recommendedScheme))) {
    problems.push(`${manifest}: recommendedScheme should be one of the skin's own schemes${ids.length ? ` (${ids.join(', ')})` : ''}`);
  }
  return problems;
}

/** The skin's manifest, or null if it's missing or unreadable */
export function readManifest(dir: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// ── Installing ───────────────────────────────────────────────────────────

export interface SourceRecord {
  source: Source;
  installedAt: string;
}

/** Copy the allowed files into skins/<name>/, replacing what's there */
export function installFiles(root: string, name: string, fromDir: string, files: string[], source: Source): string {
  const target = packageDir(root, name);
  const staging = `${target}.vg-tmp-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  for (const file of files) {
    const to = join(staging, ...file.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(fromDir, ...file.split('/')), to);
  }
  const record: SourceRecord = { source, installedAt: new Date().toISOString() };
  writeFileSync(join(staging, SOURCE_FILE), JSON.stringify(record, null, 2) + '\n');
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  return target;
}

/** skins/<name>, guaranteed to stay inside skins/ */
export function packageDir(root: string, name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`"${name}" is not a valid skin name`);
  const base = join(root, SKINS_DIR);
  mkdirSync(base, { recursive: true });
  const dir = join(base, name);
  if (relative(base, dir) !== name) throw new Error(`Refusing to use ${dir}`);
  return dir;
}

export function installedNames(root: string): string[] {
  const base = join(root, SKINS_DIR);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => NAME_RE.test(name) && statSync(join(base, name)).isDirectory())
    .sort();
}

export function readSourceRecord(dir: string): SourceRecord | null {
  try {
    const data = JSON.parse(readFileSync(join(dir, SOURCE_FILE), 'utf8'));
    return data && data.source ? data : null;
  } catch {
    return null;
  }
}

export function readContract(root: string): number | null {
  const file = resolveThemeFile(root, CONTRACT_PATH);
  if (!file) return null;
  try {
    const version = JSON.parse(readFileSync(file, 'utf8')).version;
    return typeof version === 'number' ? version : null;
  } catch {
    return null;
  }
}

// ── identity.ts ──────────────────────────────────────────────────────────

const SKINS_PATTERN = /^(\s*)skins:\s*\[([^\]\n]*)\](.*)$/m;
const SKIN_PATTERN = /^(\s*)skin:\s*(['"])([^'"\n]*)\2(.*)$/m;

/** Names in `skins: [...]`; null if the field isn't there */
export function readNameList(text: string): string[] | null {
  const match = text.match(SKINS_PATTERN);
  if (!match) return null;
  return [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Rewrite `skins: [...]` in place, keeping indentation and anything after it (like `as string[],`) */
export function writeNameList(text: string, names: string[]): string | null {
  const match = text.match(SKINS_PATTERN);
  const items = names.map((n) => `'${n}'`).join(', ');
  // Function replacements, so a `$` in the kept text isn't read as a replacement pattern
  if (match) return text.replace(SKINS_PATTERN, () => `${match[1]}skins: [${items}]${match[3]}`);

  // Older identity.ts without the field: add it right after `skin:`
  const anchorMatch = text.match(SKIN_PATTERN);
  if (!anchorMatch) return null;
  const line = anchorMatch[0];
  return text.replace(line, () => `${line}\n${anchorMatch[1]}skins: [${items}] as string[],`);
}

export function readDefaultSkin(text: string): string | null {
  return text.match(SKIN_PATTERN)?.[3] ?? null;
}

export function writeDefaultSkin(text: string, name: string): string | null {
  const match = text.match(SKIN_PATTERN);
  if (!match) return null;
  return text.replace(SKIN_PATTERN, () => `${match[1]}skin: ${match[2]}${name}${match[2]}${match[4]}`);
}
