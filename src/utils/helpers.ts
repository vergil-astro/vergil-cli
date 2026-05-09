import chalk from 'chalk';

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
 * Terminals without OSC 8 support fall through to plain text.
 */
export function link(text: string, absPath: string): string {
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
   ██║   ██║█████╗  ██║  ██║██║  ███╗██║██║
   ╚██╗ ██╔╝██╔══╝  ██║  ██║██║   ██║██║██║
    ╚████╔╝ ██║     ██████╔╝╚██████╔╝██║██║
     ╚═══╝  ╚═╝     ╚═════╝  ╚═════╝ ╚═╝╚═╝
    `));
  console.log(C.subtitle('    Vergil CLI · Write. Publish. Create.\n'));
}

export function printHelp(): void {
  console.log(C.accent('Usage:') + ' vg <command> [options]\n');

  console.log(C.subtitle('Initialize:'));
  console.log('  ' + C.accent('vg init') + '                    Initialize Vergil in current directory');
  console.log('  ' + C.accent('vg init --template <name>') + '   Use a specific theme\n');

  console.log(C.subtitle('Create Content:'));
  console.log('  ' + C.accent('vg new post') + ' "Title"        Create a blog post');
  console.log('  ' + C.accent('vg new page') + ' "Title"        Create a standalone page');
  console.log('  ' + C.accent('vg new project') + ' "Title"     Create a project showcase');
  console.log('  ' + C.accent('vg new album') + ' "Title"      Create a photo album');
  console.log('  ' + C.accent('vg new thought') + ' "Text"      Create a thought (card stream)');
  console.log('  ' + C.accent('vg new moment') + ' "Text"       Create a moment (timeline)');
  console.log('  ' + C.accent('vg new doc') + ' "Title"         Create a documentation page\n');

  console.log(C.subtitle('Development:'));
  console.log('  ' + C.accent('vg serve') + '                   Start dev server');
  console.log('  ' + C.accent('vg build') + '                   Build for production');
  console.log('  ' + C.accent('vg deploy') + '                  Build and deploy');
  console.log('  ' + C.accent('vg clean') + '                   Clean cache and build output\n');

  console.log(C.subtitle('Content Management:'));
  console.log('  ' + C.accent('vg publish') + ' [slug]          Publish a draft (pick from list if no slug)');
  console.log('  ' + C.accent('vg list') + '                    Content summary (excl. docs)');
  console.log('  ' + C.accent('vg list') + ' <type>             List items of a type: post|page|project|album|thought|moment');
  console.log('  ' + C.accent('vg series') + '                  List all series and post counts');
  console.log('  ' + C.accent('vg series') + ' <name>           Show all posts in a series');
  console.log('  ' + C.accent('vg docs') + '                    List all documentation books');
  console.log('  ' + C.accent('vg docs') + ' <book>             Show a book as a chapter tree\n');

  console.log(C.subtitle('AI Tools:'));
  console.log('  ' + C.accent('vg skill install') + '           Install AI writing skill to agents');
  console.log('  ' + C.accent('vg skill list') + '              List installed skills');
  console.log('  ' + C.accent('vg skill uninstall') + '         Remove skill from agents');
  console.log('  ' + C.accent('vg help [topic]') + '            Show directive help (e.g. callout, tabs)\n');

  console.log(C.muted('Run `vg <command> --help` for more details'));
}
