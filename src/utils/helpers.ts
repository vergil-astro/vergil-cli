import chalk from 'chalk';
import { t, withLabel, type MessageKey } from './i18n.js';

export const C = {
  title: chalk.hex('#C8A464'),
  subtitle: chalk.hex('#a09888'),
  text: chalk.hex('#f5f0e8'),
  muted: chalk.hex('#6b6560'),
  success: chalk.hex('#4ade80'),
  warning: chalk.hex('#fbbf24'),
  error: chalk.hex('#ef4444'),
  info: chalk.hex('#60a5fa'),
  accent: chalk.hex('#C8A464'),
  dim: chalk.hex('#3d3835'),
};

/**
 * Wrap text in an OSC 8 terminal hyperlink so the user can click (or
 * Cmd/Ctrl+click) to open the file in the system default app.
 * Terminals without OSC 8 support fall through to plain text; outside a
 * terminal (pipes, files, agents) the escape codes are left out entirely.
 */
export function link(text: string, absPath: string): string {
  if (!process.stdout.isTTY) return text;
  const distro = process.env.WSL_DISTRO_NAME;
  const url = distro && absPath.startsWith('/')
    ? `file://wsl.localhost/${distro}${absPath}`
    : `file://${absPath}`;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

export function printBanner(): void {
  console.log(C.title(`
   ██╗   ██╗███████╗██████╗  ██████╗ ██╗██╗
   ██║   ██║██╔════╝██╔══██╗██╔════╝ ██║██║
   ██║   ██║█████╗  ██████╔╝██║  ███╗██║██║
   ╚██╗ ██╔╝██╔══╝  ██╔══██╗██║   ██║██║██║
    ╚████╔╝ ███████╗██║  ██║╚██████╔╝██║███████╗
     ╚═══╝  ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝╚══════╝
    `));
  console.log(C.subtitle(`    Vergil CLI · ${t('help.tagline')}\n`));
}

/** One line of the help screen: the command (highlighted), its argument, what it does, and optionally its options below */
type HelpLine = [command: string, arg: string, description: MessageKey, options?: string];

/** Width of the command column, as before the help screen was translated */
const HELP_COLUMN = 27;

/** Columns a string takes in a terminal: CJK characters are two wide */
export function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return width;
}

export function printHelp(): void {
  const title = t('help.argTitle');
  const text = t('help.argText');
  const sections: Array<[MessageKey, HelpLine[]]> = [
    ['help.section.init', [
      ['vg init my-site', '', 'help.init.newFolder'],
      ['vg init', '', 'help.init.here'],
      ['vg init --template <name>', '', 'help.init.template'],
    ]],
    ['help.section.create', [
      ['vg new post', title, 'help.new.post', '--draft, --tags <list>, --series <name>, --cover <path>'],
      ['vg new page', title, 'help.new.page'],
      ['vg new project', title, 'help.new.project', '--description <text>, --website <url>, --repo <owner/repo>'],
      ['vg new album', title, 'help.new.album', '--tags <list>, --theme <golden|seasons>, --cover <path>'],
      ['vg new thought', text, 'help.new.thought', '--tags <list>'],
      ['vg new moment', text, 'help.new.moment', '--tags <list>'],
      ['vg new doc', title, 'help.new.doc', '--draft, --tags <list>, --path <book>[/<chapter>]'],
    ]],
    ['help.section.dev', [
      ['vg serve', '', 'help.serve'],
      ['vg build', '', 'help.build'],
      ['vg deploy', '', 'help.deploy'],
      ['vg clean', '', 'help.clean'],
    ]],
    ['help.section.content', [
      ['vg publish', '[slug]', 'help.publish'],
      ['vg list', '', 'help.list'],
      ['vg list', '<type>', 'help.listType'],
      ['vg series', '', 'help.series'],
      ['vg series', '<name>', 'help.seriesShow'],
      ['vg docs', '', 'help.docs'],
      ['vg docs', '-d', 'help.docsDrafts'],
      ['vg docs', '<book>', 'help.docsShow'],
    ]],
    ['help.section.images', [
      ['vg images organize', '', 'help.images.organize'],
      ['vg images check', '', 'help.images.check'],
      ['vg images expand', '', 'help.images.expand'],
    ]],
    ['help.section.directives', [
      ['vg help [topic]', '', 'help.directiveHelp'],
      ['vg directives check', '[files]', 'help.directives.check'],
      ['vg directives ref', '[names]', 'help.directives.ref'],
    ]],
    ['help.section.start', [
      ['vg reset', '', 'help.reset'],
      ['vg upgrade', '', 'help.upgrade'],
    ]],
    ['help.section.skins', [
      ['vg skin add', '<source>', 'help.skin.add'],
      ['vg skin list', '', 'help.skin.list'],
      ['vg skin use', '<name>', 'help.skin.use'],
      ['vg skin update', '[name]', 'help.skin.update'],
      ['vg skin remove', '<name>', 'help.skin.remove'],
    ]],
    ['help.section.lang', [
      ['vg lang', '[zh|en]', 'help.lang'],
    ]],
  ];

  console.log(`${withLabel(t('cli.title.usage'), 'vg <command> [options]', C.accent)}\n`);
  for (const [heading, lines] of sections) {
    console.log(C.subtitle(t(heading)));
    for (const [command, arg, description, options] of lines) {
      const usage = arg ? `${C.accent(command)} ${arg}` : C.accent(command);
      const width = textWidth(command) + (arg ? textWidth(arg) + 1 : 0);
      console.log(`  ${usage}${' '.repeat(Math.max(1, HELP_COLUMN - width))}${t(description)}`);
      if (options) console.log(`    ${C.muted(options)}`);
    }
    console.log();
  }

  console.log(C.subtitle(t('help.section.agents')));
  console.log(`  ${C.accent('--json')}${' '.repeat(HELP_COLUMN - '--json'.length)}${t('help.json')}`);
  console.log(`  ${C.muted(t('help.agentsNote'))}\n`);

  console.log(C.muted(t('help.more')));
}
