import { Help, type HelpConfiguration, type Option } from 'commander';
import { stripVTControlCharacters } from 'util';
import { textWidth } from './helpers.js';
import { t, type MessageKey } from './i18n.js';

/**
 * Commander writes some text of its own: the headings and the "(default: …)" note in
 * `--help`, and its parse errors. These map that text into the user's language; the command
 * and option descriptions are passed to commander already translated. Chinese characters are
 * two columns wide, so help columns and line wrapping measure them that way.
 */

const TITLES: Record<string, MessageKey> = {
  'Usage:': 'cli.title.usage',
  'Options:': 'cli.title.options',
  'Commands:': 'cli.title.commands',
  'Arguments:': 'cli.title.arguments',
  'Global Options:': 'cli.title.globalOptions',
};

export const helpConfiguration: HelpConfiguration = {
  styleTitle: (title: string) => (TITLES[title] ? t(TITLES[title]) : title),
  displayWidth: (text: string) => textWidth(stripVTControlCharacters(text)),
  optionDescription(this: Help, option: Option): string {
    const full = Help.prototype.optionDescription.call(this, option);
    const own = option.description ?? '';
    // Only touch the note commander appends after our own (already translated) description
    if (!full.startsWith(own)) return full;
    return own + full.slice(own.length).replace(/\(default: /, `(${t('cli.help.default')}: `);
  },
};

type Rule = [RegExp, (m: RegExpMatchArray) => string];

/** Commander's parse errors, one line at a time (a suggestion comes on its own line) */
const ERRORS: Rule[] = [
  [/^error: unknown command '(.*)'$/, (m) => t('cli.error.unknownCommand', { name: m[1] })],
  [/^error: unknown option '(.*)'$/, (m) => t('cli.error.unknownOption', { name: m[1] })],
  [/^error: missing required argument '(.*)'$/, (m) => t('cli.error.missingArgument', { name: m[1] })],
  [/^error: option '(.*)' argument missing$/, (m) => t('cli.error.optionMissingArgument', { flags: m[1] })],
  [/^error: required option '(.*)' not specified$/, (m) => t('cli.error.requiredOption', { flags: m[1] })],
  [
    /^error: too many arguments(?: for '(.*)')?\. Expected (\d+) arguments? but got (\d+): (.*)\.$/,
    (m) => {
      const vars = { name: m[1] ?? '', count: Number(m[2]), received: m[3], details: m[4] };
      return m[1] === undefined ? t('cli.error.tooManyArguments', vars) : t('cli.error.tooManyArgumentsFor', vars);
    },
  ],
  [/^\(Did you mean one of (.*)\?\)$/, (m) => t('cli.error.didYouMeanOneOf', { names: m[1] })],
  [/^\(Did you mean (.*)\?\)$/, (m) => t('cli.error.didYouMean', { name: m[1] })],
];

/** Translate commander's error text; lines it doesn't recognise pass through unchanged */
export function translateCommanderError(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      for (const [pattern, render] of ERRORS) {
        const m = line.match(pattern);
        if (m) return render(m);
      }
      return line;
    })
    .join('\n');
}
