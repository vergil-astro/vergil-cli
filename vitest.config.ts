import { tmpdir } from 'os';
import { join } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      // Tests assert vg's English messages; the language tests set VG_LANG themselves
      VG_LANG: 'en',
      // Keep the user's saved language out of the tests, and never write to it
      XDG_CONFIG_HOME: join(tmpdir(), 'vg-test-no-config'),
    },
  },
});
