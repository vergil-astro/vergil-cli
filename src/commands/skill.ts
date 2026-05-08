import ora from 'ora';
import {
  detectAgents,
  getAgentById,
  listAgentIds,
  fetchSkillContent,
  installToAgent,
  listInstalled,
  uninstallFromAgent,
  type InstallOptions,
  type AgentConfig,
} from '../utils/agents.js';
import { C } from '../utils/helpers.js';

// ── Install ───────────────────────────────────────────────────────────────

export async function skillInstallCommand(options: InstallOptions): Promise<void> {
  const targetAi = options.ai;
  const isGlobal = !!options.global;
  const modeLabel = isGlobal ? ' (global)' : '';

  // Determine which agents to install to
  let agentsToInstall: AgentConfig[];
  if (targetAi) {
    const agent = getAgentById(targetAi);
    agentsToInstall = agent ? [agent] : [];
  } else {
    agentsToInstall = await detectAgents();
  }

  if (targetAi && agentsToInstall.length === 0) {
    console.log(C.error(`✗ Unknown agent: ${targetAi}`));
    console.log(C.muted(`  Supported: ${listAgentIds().join(', ')}`));
    return;
  }

  if (agentsToInstall.length === 0) {
    console.log(C.warning('⚠ No AI agent detected in this project.'));
    console.log('');
    console.log(C.subtitle('Supported agents and their config directories:'));
    console.log(`  ${C.accent('claude')}   → .claude/skills/vergil-writing/SKILL.md`);
    console.log(`  ${C.accent('codex')}    → .codex/skills/vergil-writing/SKILL.md`);
    console.log(`  ${C.accent('cursor')}   → .cursor/skills/vergil-writing/SKILL.md`);
    console.log(`  ${C.accent('gemini')}   → .gemini/skills/vergil-writing/SKILL.md`);
    console.log(`  ${C.accent('openclaw')} → via openclaw skills install`);
    console.log('');
    console.log(C.muted('To force install to a specific agent:'));
    console.log(C.muted('  vg skill install --ai claude'));
    return;
  }

  // Fetch skill content
  const spinner = ora('Fetching skill content...').start();
  const skillContent = await fetchSkillContent(options.source || 'auto');

  if (!skillContent) {
    spinner.fail('Failed to fetch skill content');
    console.log(C.muted('  Tried: npm registry → GitHub raw'));
    return;
  }

  spinner.succeed('Skill content fetched');
  console.log('');

  // Install to each agent
  const results = [];
  for (const agent of agentsToInstall) {
    const agentSpinner = ora(`Installing to ${agent.name}${modeLabel}...`).start();
    const result = await installToAgent(agent, skillContent, options);

    if (result.success) {
      agentSpinner.succeed(`${agent.name}${modeLabel}: installed`);
      console.log(C.muted(`  → ${result.path}`));
    } else {
      agentSpinner.fail(`${agent.name}: ${result.error}`);
    }
    results.push(result);
  }

  // Summary
  const successCount = results.filter(r => r.success).length;
  console.log('');

  if (successCount > 0) {
    console.log(C.success(`✓ Installed on ${successCount}/${results.length} agent(s)`));
    console.log(C.muted('  Try asking your agent: "Enhance this article with Vergil directives"'));
  } else {
    console.log(C.error('✗ Install failed for all agents'));
    process.exit(1);
  }
}

// ── List ──────────────────────────────────────────────────────────────────

export async function skillListCommand(options: { global?: boolean }): Promise<void> {
  const installed = await listInstalled(options);
  const detected = await detectAgents();
  const detectedIds = new Set(detected.map(a => a.id));

  console.log(C.title('Installed Skills'));
  console.log('');

  let hasAny = false;
  for (const item of installed) {
    const status = item.exists
      ? C.success('✓ installed')
      : C.muted('  not installed');
    const detectedMark = detectedIds.has(item.agent.id) ? C.info(' [detected]') : '';
    console.log(`  ${C.accent(item.agent.name)}${detectedMark}`);
    console.log(`    ${status} ${C.muted(item.path)}`);
    if (item.exists) hasAny = true;
  }

  if (!hasAny) {
    console.log('');
    console.log(C.muted('No skills installed. Run: vg skill install'));
  }
}

// ── Uninstall ─────────────────────────────────────────────────────────────

export async function skillUninstallCommand(
  options: InstallOptions
): Promise<void> {
  const targetAi = options.ai;
  const isGlobal = !!options.global;

  let agentsToUninstall: AgentConfig[];
  if (targetAi) {
    const agent = getAgentById(targetAi);
    agentsToUninstall = agent ? [agent] : [];
  } else {
    agentsToUninstall = await detectAgents();
  }

  if (targetAi && agentsToUninstall.length === 0) {
    console.log(C.error(`✗ Unknown agent: ${targetAi}`));
    return;
  }

  if (agentsToUninstall.length === 0) {
    console.log(C.warning('⚠ No agent detected. Use --ai to specify.'));
    console.log(C.muted(`  Supported: ${listAgentIds().join(', ')}`));
    return;
  }

  for (const agent of agentsToUninstall) {
    const result = await uninstallFromAgent(agent, { global: isGlobal });
    if (result.success) {
      console.log(C.success(`✓ Uninstalled from ${agent.name}`));
    } else {
      console.log(C.error(`✗ ${agent.name}: ${result.error}`));
    }
  }
}