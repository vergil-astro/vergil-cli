import { execSync } from 'child_process';
import { access, mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  rootDir: string;        // e.g. '.claude'
  skillPath: string;      // e.g. 'skills/vergil-writing'
  filename: string;       // e.g. 'SKILL.md'
  detect: () => boolean | Promise<boolean>;
  install?: (skillContent: string, options: InstallOptions) => Promise<InstallResult>;
  postInstall?: (skillDir: string) => Promise<void>;
}

export interface InstallOptions {
  ai?: string;
  global?: boolean;
  local?: boolean;
  source?: string;        // 'github' | 'npm' | 'bundled'
  force?: boolean;
}

// ─── Agent Registry ─────────────────────────────────────────────────────────

export const AGENTS: AgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    rootDir: '.claude',
    skillPath: 'skills/vergil-writing',
    filename: 'SKILL.md',
    async detect() {
      return (await dirExists(join(process.cwd(), '.claude'))) ||
             (await dirExists(join(homedir(), '.claude')));
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    rootDir: '.codex',
    skillPath: 'skills/vergil-writing',
    filename: 'SKILL.md',
    async detect() {
      return (await dirExists(join(process.cwd(), '.codex'))) ||
             (await dirExists(join(homedir(), '.codex')));
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    rootDir: '.cursor',
    skillPath: 'skills/vergil-writing',
    filename: 'SKILL.md',
    async detect() {
      return (await dirExists(join(process.cwd(), '.cursor'))) ||
             (await dirExists(join(homedir(), '.cursor')));
    },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    rootDir: '.gemini',
    skillPath: 'skills/vergil-writing',
    filename: 'SKILL.md',
    async detect() {
      return (await dirExists(join(process.cwd(), '.gemini'))) ||
             (await dirExists(join(homedir(), '.gemini')));
    },
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    rootDir: '.openclaw',
    skillPath: 'skills/vergil-writing',
    filename: 'SKILL.md',
    detect() {
      try {
        execSync('command -v openclaw', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    async install(skillContent, _options) {
      const tmpDir = mkdtempSync(join(tmpdir(), 'vergil-skill-'));
      const skillFile = join(tmpDir, 'vergil-writing.skill');
      try {
        await writeFile(skillFile, skillContent, 'utf8');
        execSync(`openclaw skills install "${skillFile}"`, { stdio: 'inherit' });
        return { agent: AGENTS.find(a => a.id === 'openclaw')!, success: true };
      } catch (err) {
        return {
          agent: AGENTS.find(a => a.id === 'openclaw')!,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        try { await rm(tmpDir, { recursive: true }); } catch { /* noop */ }
      }
    },
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function getTargetDir(agent: AgentConfig, global: boolean): string {
  const base = global ? homedir() : process.cwd();
  return join(base, agent.rootDir, agent.skillPath);
}

// ─── Detection ──────────────────────────────────────────────────────────────

export async function detectAgents(): Promise<AgentConfig[]> {
  const detected: AgentConfig[] = [];
  for (const agent of AGENTS) {
    if (await agent.detect()) {
      detected.push(agent);
    }
  }
  return detected;
}

export function getAgentById(id: string): AgentConfig | undefined {
  return AGENTS.find(a => a.id === id);
}

export function listAgentIds(): string[] {
  return AGENTS.map(a => a.id);
}

// ─── Remote Fetch ───────────────────────────────────────────────────────────

const GITHUB_RAW = 'https://raw.githubusercontent.com/vergil-astro/vergil-writing-skills/main/SKILL.md';
const NPM_REGISTRY = 'https://registry.npmjs.org/vergil-writing-skills/latest';

async function fetchFromURL(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchFromNPM(): Promise<string | null> {
  try {
    const res = await fetch(NPM_REGISTRY);
    if (!res.ok) return null;
    const data = await res.json() as { dist?: { tarball?: string } };
    const tarballUrl = data.dist?.tarball;
    if (!tarballUrl) return null;

    const tarRes = await fetch(tarballUrl);
    if (!tarRes.ok) return null;

    const tmpDir = mkdtempSync(join(tmpdir(), 'vergil-npm-'));
    const tarPath = join(tmpDir, 'package.tgz');

    try {
      await writeFile(tarPath, Buffer.from(await tarRes.arrayBuffer()));
      execSync(`tar -xzf "${tarPath}" -C "${tmpDir}"`, { stdio: 'pipe' });

      const skillPath = join(tmpDir, 'package', 'SKILL.md');
      if (await dirExists(skillPath)) {
        return await readFile(skillPath, 'utf8');
      }
      return null;
    } catch {
      return null;
    } finally {
      try { await rm(tmpDir, { recursive: true }); } catch { /* noop */ }
    }
  } catch {
    return null;
  }
}

export async function fetchSkillContent(source: string = 'auto'): Promise<string | null> {
  // 1. Try npm first
  if (source === 'npm' || source === 'auto') {
    const content = await fetchFromNPM();
    if (content) return content;
  }

  // 2. Try GitHub raw
  if (source === 'github' || source === 'auto') {
    const content = await fetchFromURL(GITHUB_RAW);
    if (content) return content;
  }

  return null;
}

// ─── Install ────────────────────────────────────────────────────────────────

export interface InstallResult {
  agent: AgentConfig;
  success: boolean;
  path?: string;
  error?: string;
}

export async function installToAgent(
  agent: AgentConfig,
  skillContent: string,
  options: InstallOptions
): Promise<InstallResult> {
  // Use agent-specific install if provided
  if (agent.install) {
    return agent.install(skillContent, options);
  }

  const targetDir = getTargetDir(agent, !!options.global);
  const targetFile = join(targetDir, agent.filename);

  try {
    // Check existing
    if (!options.force && await dirExists(targetFile)) {
      return {
        agent,
        success: false,
        error: 'Already installed (use --force to overwrite)',
      };
    }

    // Create dirs
    await mkdir(targetDir, { recursive: true });

    // Write SKILL.md
    await writeFile(targetFile, skillContent, 'utf8');

    // Run post-install hook if any
    if (agent.postInstall) {
      await agent.postInstall(targetDir);
    }

    return { agent, success: true, path: targetFile };
  } catch (err) {
    return {
      agent,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── List ───────────────────────────────────────────────────────────────────

export interface InstalledSkill {
  agent: AgentConfig;
  path: string;
  exists: boolean;
}

export async function listInstalled(options: { global?: boolean } = {}): Promise<InstalledSkill[]> {
  const installed: InstalledSkill[] = [];

  for (const agent of AGENTS) {
    const targetDir = getTargetDir(agent, !!options.global);
    const targetFile = join(targetDir, agent.filename);
    const exists = await dirExists(targetFile);
    installed.push({ agent, path: targetFile, exists });
  }

  return installed;
}

// ─── Uninstall ──────────────────────────────────────────────────────────────

export async function uninstallFromAgent(
  agent: AgentConfig,
  options: { global?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const targetDir = getTargetDir(agent, !!options.global);
    const targetFile = join(targetDir, agent.filename);

    if (await dirExists(targetFile)) {
      await rm(targetFile);
    }

    // Clean up empty dir
    try {
      const files = await readdir(targetDir);
      if (files.length === 0) {
        await rm(targetDir, { recursive: true });
      }
    } catch {
      // noop
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
