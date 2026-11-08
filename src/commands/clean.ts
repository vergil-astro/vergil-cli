import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { C } from '../utils/helpers.js';
import { getProjectRoot } from '../utils/file.js';
import { failNotInSite } from '../utils/output.js';
import { t } from '../utils/i18n.js';

export async function cleanCommand(): Promise<void> {
  const root = getProjectRoot();
  if (!root) return failNotInSite();

  // node_modules/.astro is Astro's own cache, including the rendered Markdown it reuses between builds
  const dirsToClean = ['dist', '.astro', 'node_modules/.astro', 'node_modules/.vite'];

  for (const dir of dirsToClean) {
    const fullPath = join(root, dir);
    if (existsSync(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true });
      console.log(C.success(t('clean.cleaned', { dir })));
    }
  }

  console.log(C.accent(`\n${t('clean.done')}`));
}
