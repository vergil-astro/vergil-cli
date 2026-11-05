import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';

/**
 * Directive help reads the site's own schema (src/plugins/directives/schema.mjs),
 * so it always matches the theme version the site runs. The same schema drives
 * the theme's `pnpm directives:ref` and `pnpm directives:check`.
 */
const SCHEMA_PATH = join('src', 'plugins', 'directives', 'schema.mjs');

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
    console.log(C.error('✗ Not inside a Vergil site'));
    console.log(C.muted('  Directive help reads the site\'s own directive list. Run it from your site folder.'));
    return null;
  }
  const file = join(root, SCHEMA_PATH);
  if (!existsSync(file)) {
    console.log(C.error(`✗ No directive list at ${SCHEMA_PATH}`));
    console.log(C.muted('  This site runs an older theme. Update the theme to get directive help.'));
    return null;
  }
  return (await import(pathToFileURL(file).href)) as DirectiveSchema;
}

function describeAttr(attr: AttrSpec): string {
  const parts = [attr.values?.length ? attr.values.join(' | ') : attr.type];
  if (attr.format && attr.type !== 'enum') parts.push(`(${attr.format})`);
  if (attr.default) parts.push(`default ${attr.default}`);
  if (attr.required) parts.push('required');
  return parts.join(', ');
}

function printDirective(d: DirectiveSpec): void {
  console.log(C.accent(`\n${d.name.toUpperCase()}\n`));
  console.log(`${C.text('Category:')} ${d.category}`);
  console.log(`${C.text('Syntax:')} ${d.forms.map((f) => C.accent(FORM_SYNTAX[f](d.name))).join('  or  ')}`);
  console.log(`${C.text('Desc:')} ${d.summary}\n`);

  const attrs = Object.entries(d.attrs);
  if (attrs.length) {
    console.log(C.subtitle('Attributes:'));
    const width = Math.max(...attrs.map(([key]) => key.length)) + 2;
    for (const [key, attr] of attrs) {
      console.log(`  ${C.accent(key.padEnd(width))}${attr.desc}`);
      console.log(`  ${' '.repeat(width)}${C.muted(describeAttr(attr))}`);
    }
    for (const group of d.oneOf || []) console.log(C.muted(`  At least one of: ${group.join(', ')}`));
    console.log();
  }
  if (d.body) console.log(`${C.text('Body:')} ${d.body.desc}\n`);

  console.log(C.subtitle('Example:'));
  console.log(C.muted(d.example));
  if (d.notes?.length) {
    console.log();
    console.log(C.subtitle('Notes:'));
    d.notes.forEach((n) => console.log(`  - ${n}`));
  }
  console.log();
}

function printExtra(e: ExtraSpec): void {
  console.log(C.accent(`\n${e.title}\n`));
  console.log(C.subtitle('Example:'));
  console.log(C.muted(e.example));
  console.log();
  e.notes.forEach((n) => console.log(`  - ${n}`));
  console.log();
}

export async function directiveHelpCommand(topic?: string): Promise<void> {
  const schema = await loadSchema();
  if (!schema) return;
  const { CATEGORIES, DIRECTIVES, EXTRAS } = schema;

  if (!topic || topic === 'directives') {
    console.log(C.accent(`\nVergil Directives — ${DIRECTIVES.length} 个内容指令\n`));
    console.log(C.muted('Use `vg help <directive>` for syntax; `vg help code` and `vg help math` cover code blocks and math.'));
    console.log(C.muted('`pnpm directives:ref` prints the full reference as Markdown, `pnpm directives:check` checks your posts.\n'));

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
  if (directive) return printDirective(directive);

  const extra = EXTRAS.find((e) => e.name === name);
  if (extra) return printExtra(extra);

  console.log(C.error(`✗ Directive not found: ${topic}`));
  console.log(C.muted('Run `vg help directives` to see all'));
}
