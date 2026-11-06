/** Minimal x.y.z comparison for theme versions (pre-release tags are not used) */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Items whose version is in (from, to], oldest first */
export function inRange<T extends { version: string }>(items: T[], from: string, to: string): T[] {
  return items
    .filter((item) => compareVersions(item.version, from) > 0 && compareVersions(item.version, to) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}
