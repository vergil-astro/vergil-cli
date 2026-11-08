import { relative, sep } from 'path';
import { C } from './helpers.js';
import { t } from './i18n.js';

/**
 * Output rules, so agents and scripts can rely on vg:
 * - results go to stdout; errors and warnings go to stderr (spinners too)
 * - a failed command exits non-zero
 * - `--json` writes exactly one JSON document to stdout
 * - colors, hyperlinks, the banner and spinners only appear in a terminal
 * - nothing waits for an answer unless a person is at the terminal
 */

/** stdout is a terminal, not a pipe, file or agent */
export const stdoutIsTTY = Boolean(process.stdout.isTTY);

/** Someone can answer a prompt */
export const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** Report a failure on stderr; the process exits with 1 once the command returns */
export function fail(message: string, ...hints: string[]): void {
  console.error(C.error(`✗ ${message}`));
  for (const hint of hints) console.error(C.muted(`  ${hint}`));
  process.exitCode = 1;
}

/** Report a warning on stderr without failing */
export function warn(message: string, ...hints: string[]): void {
  console.error(C.warning(`⚠ ${message}`));
  for (const hint of hints) console.error(C.muted(`  ${hint}`));
}

/** The whole stdout of a `--json` run */
export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/** Path relative to the site root with forward slashes, as shown to users and in JSON */
export function sitePath(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

/** The hint under every "not in a site" error */
export function notInSiteHint(): string {
  return t('common.notInSiteHint');
}

/** The error for a command that needs a site but runs outside one */
export function failNotInSite(): void {
  fail(t('common.notInProject'), notInSiteHint());
}
