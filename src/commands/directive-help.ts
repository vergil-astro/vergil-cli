import { pathToFileURL } from 'url';
import { resolveThemeFile } from '../utils/theme.js';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { fail, printJson } from '../utils/output.js';
import { t, withLabel, type MessageKey } from '../utils/i18n.js';
import type { JsonOptions } from '../types.js';

/**
 * Directive help reads the schema of the theme the site runs (plugins/directives/schema.mjs
 * in @vergil-astro/theme, or in src/ for older template-style sites),
 * so it always matches the theme version the site runs. The same schema drives
 * `vg directives ref` and `vg directives check`.
 *
 * The directive text (summaries, attribute docs, examples, notes) comes from the theme and is
 * shown as it is; only vg's own labels around it follow the user's language.
 */
const SCHEMA_PATH = 'plugins/directives/schema.mjs';

interface AttrSpec {
  type: 'string' | 'enum' | 'list' | 'boolean' | 'number' | 'color';
  values?: string[];
  required?: boolean;
  default?: string;
  format?: string;
  desc: string;
}

interface DirectiveSpec {
  name: string;
  category: string;
  forms: ('container' | 'leaf' | 'text')[];
  summary: string;
  attrs: Record<string, AttrSpec>;
  oneOf?: string[][];
  body?: { desc: string };
  notes?: string[];
  example: string;
}

interface ExtraSpec {
  name: string;
  title: string;
  example: string;
  notes: string[];
}

interface DirectiveSchema {
  CATEGORIES: string[];
  DIRECTIVES: DirectiveSpec[];
  EXTRAS: ExtraSpec[];
}

/** Names from older vg versions */
const ALIASES: Record<string, string> = { terminal: 'code' };

const FORM_SYNTAX: Record<DirectiveSpec['forms'][number], (name: string) => string> = {
  container: (name) => `:::${name}{...} … :::`,
  leaf: (name) => `::${name}{...}`,
  text: (name) => `:${name}[...]{...}`,
};

async function loadSchema(): Promise<DirectiveSchema | null> {
  const root = getProjectRoot();
  if (!root) {
    fail(t('directive.notInSite'), t('directive.notInSiteHint'));
    return null;
  }
  const file = resolveThemeFile(root, SCHEMA_PATH);
  if (!file) {
    fail(t('directive.noSchema'), t('directive.noSchemaHint'));
    return null;
  }
  return (await import(pathToFileURL(file).href)) as DirectiveSchema;
}

function describeAttr(attr: AttrSpec): string {
  const parts = [attr.values?.length ? attr.values.join(' | ') : t(`directive.type.${attr.type}`)];
  if (attr.format && attr.type !== 'enum') parts.push(`(${attr.format})`);
  if (attr.default) parts.push(t('directive.default', { value: attr.default }));
  if (attr.required) parts.push(t('directive.required'));
  return parts.join(t('directive.attrSep'));
}

/** `Category: …` style line, label highlighted */
function field(label: MessageKey, value: string): string {
  return withLabel(t(label), value, C.text);
}

function printDirective(d: DirectiveSpec): void {
  console.log(C.accent(`\n${d.name.toUpperCase()}\n`));
  console.log(field('directive.category', d.category));
  console.log(field('directive.syntax', d.forms.map((f) => C.accent(FORM_SYNTAX[f](d.name))).join(`  ${t('directive.syntaxOr')}  `)));
  console.log(`${field('directive.desc', d.summary)}\n`);

  const attrs = Object.entries(d.attrs);
  if (attrs.length) {
    console.log(C.subtitle(t('directive.attributes')));
    const width = Math.max(...attrs.map(([key]) => key.length)) + 2;
    for (const [key, attr] of attrs) {
      console.log(`  ${C.accent(key.padEnd(width))}${attr.desc}`);
      console.log(`  ${' '.repeat(width)}${C.muted(describeAttr(attr))}`);
    }
    for (const group of d.oneOf || []) console.log(C.muted(`  ${t('directive.atLeastOne', { list: group.join(', ') })}`));
    console.log();
  }
  if (d.body) console.log(`${field('directive.body', d.body.desc)}\n`);

  console.log(C.subtitle(t('directive.example')));
  console.log(C.muted(d.example));
  if (d.notes?.length) {
    console.log();
    console.log(C.subtitle(t('directive.notes')));
    d.notes.forEach((n) => console.log(`  - ${n}`));
  }
  console.log();
}

function printExtra(e: ExtraSpec): void {
  console.log(C.accent(`\n${e.title}\n`));
  console.log(C.subtitle(t('directive.example')));
  console.log(C.muted(e.example));
  console.log();
  e.notes.forEach((n) => console.log(`  - ${n}`));
  console.log();
}

export async function directiveHelpCommand(topic?: string, options: JsonOptions = {}): Promise<void> {
  const schema = await loadSchema();
  if (!schema) return;
  const { CATEGORIES, DIRECTIVES, EXTRAS } = schema;

  if (!topic || topic === 'directives') {
    if (options.json) {
      // Names and one-liners only; `vg help <name> --json` has the full spec
      return printJson({
        count: DIRECTIVES.length,
        categories: CATEGORIES.map((name) => ({
          name,
          directives: DIRECTIVES.filter((d) => d.category === name).map((d) => ({ name: d.name, summary: d.summary })),
        })),
        extras: EXTRAS.map((e) => ({ name: e.name, title: e.title })),
      });
    }
    console.log(C.accent(`\n${t('directive.listTitle', { count: DIRECTIVES.length })}\n`));
    console.log(C.muted(t('directive.listHintHelp')));
    console.log(C.muted(`${t('directive.listHintScripts')}\n`));

    for (const category of CATEGORIES) {
      console.log(C.subtitle(`${category}:`));
      DIRECTIVES.filter((d) => d.category === category).forEach((d) => {
        console.log(`  ${C.accent(d.name.padEnd(16))} ${C.text(d.summary)}`);
      });
      console.log();
    }
    return;
  }

  const name = ALIASES[topic] || topic;
  const directive = DIRECTIVES.find((d) => d.name === name);
  if (directive) return options.json ? printJson(directive) : printDirective(directive);

  const extra = EXTRAS.find((e) => e.name === name);
  if (extra) return options.json ? printJson(extra) : printExtra(extra);

  fail(t('directive.notFound', { topic }), t('directive.notFoundHint'));
}
