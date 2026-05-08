import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { printBanner, printHelp, C } from './utils/helpers.js';

import { initCommand } from './commands/init.js';
import { newCommand } from './commands/new.js';
import { serveCommand } from './commands/serve.js';
import { buildCommand } from './commands/build.js';
import { deployCommand } from './commands/deploy.js';
import { publishCommand } from './commands/publish.js';
import { listCommand } from './commands/list.js';
import { cleanCommand } from './commands/clean.js';
import { seriesListCommand, seriesShowCommand } from './commands/series.js';
import { docsListCommand, docsShowCommand } from './commands/docs.js';
import { directiveHelpCommand } from './commands/directive-help.js';
import { skillInstallCommand, skillListCommand, skillUninstallCommand } from './commands/skill.js';
import type { ListOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

program
  .name('vg')
  .description('CLI for Vergil Astro theme — write, publish, and create')
  .version(pkg.version, '-v, --version', 'Show version')
  .usage('[command] [options]')
  .configureOutput({
    outputError: (str, write) => write(C.error(str)),
  });

// -- Initialize --
program
  .command('init')
  .description('Initialize a Vergil project in the current directory')
  .option('-t, --template <name>', 'GitHub repo to clone (default: vergil-astro/vergil-astro-theme)', 'vergil-astro/vergil-astro-theme')
  .option('--skip-install', 'Skip dependency installation')
  .option('--skip-serve', 'Skip starting dev server after init')
  .action(initCommand);

// -- Create Content --
program
  .command('new <type> <title>')
  .description('Create new content. Types: post, page, project, album, thought, moment, doc')
  .option('-d, --draft', 'Save as draft')
  .option('-t, --tags <list>', 'Comma-separated tags')
  .option('-c, --cover <path>', 'Cover image path')
  .option('-s, --series <name>', 'Series name (for posts)')
  .option('-w, --website <url>', 'Project website URL')
  .option('-r, --repo <url>', 'GitHub repo URL')
  .option('--description <text>', 'Description (for projects)')
  .option('--theme <name>', 'Album theme: golden|seasons', 'golden')
  .option('-p, --path <path>', 'Sub-directory path (for docs)')
  .action(newCommand);

// -- Development --
program
  .command('serve')
  .description('Start Astro dev server')
  .option('-p, --port <port>', 'Port number', '4321')
  .option('-h, --host', 'Expose to network')
  .action(serveCommand);

program
  .command('build')
  .description('Build the site for production')
  .action(buildCommand);

program
  .command('deploy')
  .description('Build and deploy to hosting')
  .option('-t, --target <target>', 'Target: github|vercel|netlify', 'github')
  .action(deployCommand);

program
  .command('clean')
  .description('Clean cache and build output')
  .action(cleanCommand);

// -- Content Management --
program
  .command('publish [slug]')
  .description('Publish a draft (remove draft flag). Run without slug to pick interactively.')
  .action(publishCommand);

program
  .command('list [type]')
  .description('List content — `vg list` for summary, `vg list <type>` for items')
  .option('-d, --drafts', 'Show only drafts')
  .action((type: string | undefined, options: ListOptions) => listCommand(type, options));

const seriesCmd = program
  .command('series [name]')
  .description('Manage post series — `vg series` lists, `vg series <name>` shows one')
  .action((name?: string) => {
    if (!name) return seriesListCommand();
    return seriesShowCommand(name);
  });

seriesCmd
  .command('list')
  .description('List all series and post counts')
  .action(seriesListCommand);

seriesCmd
  .command('show <name>')
  .description('Show all posts in a series')
  .action(seriesShowCommand);

const docsCmd = program
  .command('docs [book]')
  .description('Browse documentation books — `vg docs` lists, `vg docs <book>` shows one')
  .action((book?: string) => {
    if (!book) return docsListCommand();
    return docsShowCommand(book);
  });

docsCmd
  .command('list')
  .description('List all books with chapter counts')
  .action(docsListCommand);

docsCmd
  .command('show <book>')
  .description('Show a book as a chapter tree')
  .action(docsShowCommand);

// -- Skill --
const skillCmd = program
  .command('skill')
  .description('Manage AI agent skills for Vergil directives');

skillCmd
  .command('install')
  .description('Install Vergil writing skill to detected AI agents')
  .option('-a, --ai <agent>', 'Target agent: claude|codex|cursor|gemini|openclaw|all')
  .option('-g, --global', 'Install to global config (~/)')
  .option('-s, --source <source>', 'Source: npm|github|auto', 'auto')
  .option('-f, --force', 'Overwrite existing installation')
  .action(skillInstallCommand);

skillCmd
  .command('list')
  .description('List installed skills')
  .option('-g, --global', 'Show global installations')
  .action(skillListCommand);

skillCmd
  .command('uninstall')
  .description('Remove Vergil skill from agents')
  .option('-a, --ai <agent>', 'Target agent to uninstall from')
  .option('-g, --global', 'Uninstall from global config')
  .action(skillUninstallCommand);

// -- Help --
program
  .command('help [topic]')
  .description('Show help for a topic (directives, new, init, etc.)')
  .action(directiveHelpCommand);

// -- Parse --
const args = process.argv.slice(2);
if (args.length === 0) {
  printBanner();
  printHelp();
} else {
  program.parse();
}
