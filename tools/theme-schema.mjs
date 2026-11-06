/**
 * 读站点所用主题的指令规则（schema.mjs），保证 vg 的检查和站点实际装的主题版本一致。
 * 先找站点装的 npm 包 @vergil-astro/theme；找不到时退回旧的模板式站点（主题源码直接在站点的 src/ 里）。
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadDirectiveSchema(root = process.cwd()) {
    try {
        const require = createRequire(path.join(root, 'package.json'));
        const file = require.resolve('@vergil-astro/theme/plugins/directives/schema.mjs');
        return await import(pathToFileURL(file).href);
    } catch {}
    const legacy = path.join(root, 'src/plugins/directives/schema.mjs');
    if (existsSync(legacy)) return import(pathToFileURL(legacy).href);
    console.error('找不到主题的指令规则：当前站点没有安装 @vergil-astro/theme。');
    process.exit(1);
}
