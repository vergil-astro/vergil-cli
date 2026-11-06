/**
 * pnpm 11+ stops `pnpm install` when a dependency's install script hasn't been allowed or denied
 * in pnpm-workspace.yaml (allowBuilds). The theme decides for every dependency it brings in, in the
 * pnpm-workspace.yaml of its repo, which it also publishes in the package. `vg init` gives a new
 * site that block; `vg upgrade` adds the entries a newer theme version brings, leaving the site's
 * own decisions alone. Plain line handling: these files are small and written in one known shape.
 */

/** The top-level allowBuilds: block of a pnpm-workspace.yaml, with the comment lines right above it */
export function allowBuildsBlock(yaml: string): string | null {
  const lines = yaml.split(/\r?\n/);
  const key = lines.findIndex((line) => /^allowBuilds:\s*$/.test(line));
  if (key < 0) return null;
  let start = key;
  while (start > 0 && lines[start - 1].startsWith('#')) start--;
  let end = key + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  if (end === key + 1) return null;
  return lines.slice(start, end).join('\n') + '\n';
}

/** Package name of an entry line such as `  sharp: false` or `  '@scope/pkg': true` */
function entryName(line: string): string | null {
  const m = /^\s+(['"]?)(.+?)\1\s*:/.exec(line);
  return m ? m[2] : null;
}

/**
 * Add the theme's allowBuilds entries that the site doesn't have yet. Entries the site already has
 * keep the site's value. Returns the new file text and the package names that were added.
 */
export function mergeAllowBuilds(siteYaml: string | null, themeBlock: string): { yaml: string; added: string[] } {
  const themeLines = themeBlock.split('\n');
  const themeEntries = themeLines.slice(themeLines.findIndex((l) => /^allowBuilds:/.test(l)) + 1).filter((l) => entryName(l));

  if (!siteYaml?.trim()) {
    return { yaml: themeBlock, added: themeEntries.map((l) => entryName(l)!) };
  }

  const lines = siteYaml.replace(/\n+$/, '').split(/\r?\n/);
  const key = lines.findIndex((line) => /^allowBuilds:\s*$/.test(line));
  if (key < 0) {
    return { yaml: `${lines.join('\n')}\n\n${themeBlock}`, added: themeEntries.map((l) => entryName(l)!) };
  }

  let end = key + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  const have = new Set(lines.slice(key + 1, end).map(entryName).filter(Boolean));
  const missing = themeEntries.filter((l) => !have.has(entryName(l)));
  lines.splice(end, 0, ...missing);
  return { yaml: lines.join('\n') + '\n', added: missing.map((l) => entryName(l)!) };
}
