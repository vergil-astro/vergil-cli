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
import { runTool } from './commands/tools.js';
import { upgradeCommand } from './commands/upgrade.js';
import { askLanguage, langCommand, shouldAskLanguage } from './commands/lang.js';
import type { JsonOptions, ListOptions } from './types.js';
import { helpConfiguration, translateCommanderError } from './utils/commander-i18n.js';
import { t } from './utils/i18n.js';
import { stdoutIsTTY } from './utils/output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
const args = process.argv.slice(2);

// The first run in a terminal asks for the language; everything below is built in that language
if (shouldAskLanguage(args)) await askLanguage();

program
  .name('vg')
  .description(t('cli.description'))
  .version(pkg.version, '-v, --version', t('cli.version'))
  .usage('[command] [options]')
  // Before any subcommand is added, so they all inherit it
  .helpOption('-h, --help', t('cli.helpOption'))
  .configureHelp(helpConfiguration)
  .configureOutput({
    outputError: (str, write) => write(C.error(translateCommanderError(str))),
  });

/** A command group: `vg <group> help` describes itself in the user's language too */
function group(cmd: Command): Command {
  return cmd.helpCommand('help [command]', t('cli.helpCommand'));
}

// -- Initialize --
program
  .command('init [dir]')
  .description(t('cli.init'))
  .option('-t, --template <name>', t('cli.init.template'), 'vergil-astro/vergil-astro-theme')
  .option('-r, --ref <ref>', t('cli.init.ref'))
  .option('--from <dir>', t('cli.init.from'))
  .option('--theme <spec>', t('cli.init.theme'))
  .option('--skip-install', t('cli.init.skipInstall'))
  .option('--skip-serve', t('cli.init.skipServe'))
  .action(initCommand);

// -- Create Content --
program
  .command('new <type> <title>')
  .description(t('cli.new'))
  .option('-d, --draft', t('cli.new.draft'))
  .option('-t, --tags <list>', t('cli.new.tags'))
  .option('-c, --cover <path>', t('cli.new.cover'))
  .option('-s, --series <name>', t('cli.new.series'))
  .option('-w, --website <url>', t('cli.new.website'))
  .option('-r, --repo <repo>', t('cli.new.repo'))
  .option('--description <text>', t('cli.new.description'))
  .option('--theme <name>', t('cli.new.theme'), 'golden')
  .option('-p, --path <path>', t('cli.new.path'))
  .addHelpText('after', `
${t('cli.new.byType')}
  post      --draft, --tags, --series, --cover
  page      ${t('cli.new.none')}
  project   --description, --website, --repo
  album     --tags, --theme, --cover
  thought   --tags
  moment    --tags
  doc       --draft, --tags, --path ${t('cli.new.docPathNote')}
`)
  .action(newCommand);

// -- Development --
program
  .command('serve')
  .description(t('cli.serve'))
  .option('-p, --port <port>', t('cli.serve.port'), '4321')
  .option('-h, --host', t('cli.serve.host'))
  .action(serveCommand);

program
  .command('build')
  .description(t('cli.build'))
  .action(buildCommand);

program
  .command('deploy')
  .description(t('cli.deploy'))
  .option('-t, --target <target>', t('cli.deploy.target'), 'github')
  .action(deployCommand);

program
  .command('clean')
  .description(t('cli.clean'))
  .action(cleanCommand);

// -- Content Management --
program
  .command('publish [slug]')
  .description(t('cli.publish'))
  .action(publishCommand);

const JSON_FLAG = '--json';
const JSON_DESC = t('cli.json');
const DRAFTS_DESC = t('cli.drafts');

/** Options of a subcommand merged with its parent's: `vg docs list -d` puts -d on either one */
function mergedOpts(cmd: Command): ListOptions {
  return { ...(cmd.parent?.opts() as ListOptions | undefined), ...(cmd.opts() as ListOptions) };
}

program
  .command('list [type]')
  .description(t('cli.list'))
  .option('-d, --drafts', DRAFTS_DESC)
  .option(JSON_FLAG, JSON_DESC)
  .action((type: string | undefined, options: ListOptions) => listCommand(type, options));

const seriesCmd = program
  .command('series [name]')
  .description(t('cli.series'))
  .option(JSON_FLAG, JSON_DESC)
  .action((name: string | undefined, options: ListOptions) => {
    if (!name) return seriesListCommand(options);
    return seriesShowCommand(name, options);
  });

seriesCmd
  .command('list')
  .description(t('cli.series.list'))
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command) {
    return seriesListCommand(mergedOpts(this));
  });

seriesCmd
  .command('show <name>')
  .description(t('cli.series.show'))
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command, name: string) {
    return seriesShowCommand(name, mergedOpts(this));
  });

const docsCmd = program
  .command('docs [book]')
  .description(t('cli.docs'))
  .option('-d, --drafts', DRAFTS_DESC)
  .option(JSON_FLAG, JSON_DESC)
  .action((book?: string, options?: ListOptions) => {
    if (!book) return docsListCommand(options?.drafts, options?.json);
    return docsShowCommand(book, options?.drafts, options?.json);
  });

docsCmd
  .command('list')
  .description(t('cli.docs.list'))
  .option('-d, --drafts', DRAFTS_DESC)
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command) {
    const opts = mergedOpts(this);
    return docsListCommand(opts.drafts, opts.json);
  });

docsCmd
  .command('show <book>')
  .description(t('cli.docs.show'))
  .option('-d, --drafts', DRAFTS_DESC)
  .option(JSON_FLAG, JSON_DESC)
  .action(function (this: Command, book: string) {
    const opts = mergedOpts(this);
    return docsShowCommand(book, opts.drafts, opts.json);
  });

// -- Skins --
const skinCmd = group(program
  .command('skin')
  .description(t('cli.skin')));

skinCmd
  .command('add <source>')
  .description(t('cli.skin.add'))
  .option('-n, --name <name>', t('cli.skin.add.name'))
  .option('-f, --force', t('cli.skin.add.force'))
  .option('--no-enable', t('cli.skin.add.noEnable'))
  .action(skinAddCommand);

skinCmd
  .command('list')
  .description(t('cli.skin.list'))
  .action(skinListCommand);

skinCmd
  .command('use <name>')
  .description(t('cli.skin.use'))
  .action(skinUseCommand);

skinCmd
  .command('update [name]')
  .description(t('cli.skin.update'))
  .action(skinUpdateCommand);

skinCmd
  .command('remove <name>')
  .description(t('cli.skin.remove'))
  .option('-y, --yes', t('cli.skin.remove.yes'))
  .action(skinRemoveCommand);

// -- Content tools --
const imagesCmd = group(program
  .command('images')
  .description(t('cli.images')));

imagesCmd
  .command('organize')
  .description(t('cli.images.organize'))
  .action(() => runTool('organize-images'));

imagesCmd
  .command('check')
  .description(t('cli.images.check'))
  .action(() => runTool('check-images'));

imagesCmd
  .command('expand')
  .description(t('cli.images.expand'))
  .action(() => runTool('expand-images'));

const directivesCmd = group(program
  .command('directives')
  .description(t('cli.directives')));

directivesCmd
  .command('check [files...]')
  .description(t('cli.directives.check'))
  .action((files: string[] = []) => runTool('check-directives', files));

directivesCmd
  .command('ref [names...]')
  .description(t('cli.directives.ref'))
  .action((names: string[] = []) => runTool('directive-ref', names));

program
  .command('reset')
  .description(t('cli.reset'))
  .option('--all', t('cli.reset.all'))
  .option('--dry', t('cli.reset.dry'))
  .action((options: { all?: boolean; dry?: boolean }) => runTool('reset-content', [...(options.all ? ['--all'] : []), ...(options.dry ? ['--dry'] : [])]));

// -- Upgrade --
program
  .command('upgrade')
  .description(t('cli.upgrade'))
  .option('--to <version>', t('cli.upgrade.to'))
  .option('--dry-run', t('cli.upgrade.dryRun'))
  .option('--skip-check', t('cli.upgrade.skipCheck'))
  .action(upgradeCommand);

// -- Help --
program
  .command('help [topic]')
  .description(t('cli.help'))
  .option(JSON_FLAG, JSON_DESC)
  .action((topic: string | undefined, options: JsonOptions) => directiveHelpCommand(topic, options));

// -- Language --
program
  .command('lang [language]')
  .description(t('cli.lang'))
  .action((language: string | undefined) => langCommand(language));

// -- Parse --
if (args.length === 0) {
  if (stdoutIsTTY) printBanner();
  printHelp();
} else {
  program.parse();
}
