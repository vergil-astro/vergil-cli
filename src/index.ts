import { program, Command } from 'commander';
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
import { skinAddCommand, skinListCommand, skinRemoveCommand, skinUpdateCommand, skinUseCommand } from './commands/skin.js';
import type { JsonOptions, ListOptions } from './types.js';
import { stdoutIsTTY } from './utils/output.js';

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
  .option('-r, --repo <repo>', 'GitHub repo, owner/repo or URL (for projects)')
  .option('--description <text>', 'Description (for projects)')
  .option('--theme <name>', 'Album theme: golden|seasons', 'golden')
  .option('-p, --path <path>', 'Folder for docs: <book> or <book>/<chapter>')
  .addHelpText('after', `
Options by type:
  post      --draft, --tags, --series, --cover
  page      (none)
  project   --description, --website, --repo
  album     --tags, --theme, --cover
  thought   --tags
  moment    --tags
  doc       --draft, --tags, --path (omit --path to start a new book)
`)
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
  .description('Publish a draft (remove draft flag). Without a slug, pick from a list (terminal only).')
  .action(publishCommand);

const JSON_FLAG = '--json';
const JSON_DESC = 'Print one JSON document to stdout instead of text';

/** Options of a subcommand merged with its parent's: `vg docs list -d` puts -d on either one */
function mergedOpts(cmd: Command): ListOptions {
  return { ...(cmd.parent?.opts() as ListOptions | undefined), ...(cmd.opts() as ListOptions) };
}

program
  .command('list [type]')
  .description('List content — `vg list` for summary, `vg list <type>` for items')
  .option('-d, --drafts', 'Show only drafts')
  .option(JSON_FLAG, JSON_DESC)
  .action((type: string | undefined, options: ListOptions) => listCommand(type, options));

const seriesCmd = program
  .command('series [name]')
  .description('Manage post series — `vg series` lists, `vg series <name>` shows one')
  .option(JSON_FLAG, JSON_DESC)
  .action((name: string | undefined, options: ListOptions) => {
    if (!name) return seriesListCommand(options);
    return seriesShowCommand(name, options);
  });

seriesCmd
  .command('list')
  .description('List all series and post counts')
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command) {
    return seriesListCommand(mergedOpts(this));
  });

seriesCmd
  .command('show <name>')
  .description('Show all posts in a series')
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command, name: string) {
    return seriesShowCommand(name, mergedOpts(this));
  });

const docsCmd = program
  .command('docs [book]')
  .description('Browse documentation books — `vg docs` lists, `vg docs <book>` shows one')
  .option('-d, --drafts', 'Show only drafts')
  .option(JSON_FLAG, JSON_DESC)
  .action((book?: string, options?: ListOptions) => {
    if (!book) return docsListCommand(options?.drafts, options?.json);
    return docsShowCommand(book, options?.drafts, options?.json);
  });

docsCmd
  .command('list')
  .description('List all books with chapter counts')
  .option('-d, --drafts', 'Show only drafts')
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command) {
    const opts = mergedOpts(this);
    return docsListCommand(opts.drafts, opts.json);
  });

docsCmd
  .command('show <book>')
  .description('Show a book as a chapter tree')
  .option('-d, --drafts', 'Show only drafts')
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command, book: string) {
    const opts = mergedOpts(this);
    return docsShowCommand(book, opts.drafts, opts.json);
  });

// -- Skins --
const skinCmd = program
  .command('skin')
  .description('Install and manage skins (skins/<name>/, enabled in identity.ts). Extra color schemes come bundled in skins');

skinCmd
  .command('add <source>')
  .description('Install a skin: a name from vergil-astro/vergil-skins, a GitHub repo or folder in one (owner/repo[/folder][#ref]), or a local folder')
  .option('-n, --name <name>', 'Install under this name')
  .option('-f, --force', 'Replace an existing install')
  .option('--no-enable', "Don't add it to skins in identity.ts")
  .action(skinAddCommand);

skinCmd
  .command('list')
  .description('List built-in, installed and enabled skins')
  .action(skinListCommand);

skinCmd
  .command('use <name>')
  .description('Make a skin the default for visitors who haven\'t picked one')
  .action(skinUseCommand);

skinCmd
  .command('update [name]')
  .description('Re-fetch installed skins from where they were installed from')
  .action(skinUpdateCommand);

skinCmd
  .command('remove <name>')
  .description('Disable a skin and delete its folder')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(skinRemoveCommand);

// -- Help --
program
  .command('help [topic]')
  .description('Directive help from this site\'s theme: `vg help directives`, `vg help callout`')
  .option(JSON_FLAG, JSON_DESC)
  .action((topic: string | undefined, options: JsonOptions) => directiveHelpCommand(topic, options));

// -- Parse --
const args = process.argv.slice(2);
if (args.length === 0) {
  if (stdoutIsTTY) printBanner();
  printHelp();
} else {
  program.parse();
}
