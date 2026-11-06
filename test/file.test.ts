import { afterEach, describe, expect, it } from 'vitest';
import { formatDate } from '../src/utils/file.js';

describe('formatDate', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('uses the local date, not the UTC one', () => {
    process.env.TZ = 'Asia/Shanghai';
    expect(formatDate(new Date('2026-11-06T18:49:00Z'))).toBe('2026-11-07');
    process.env.TZ = 'America/Los_Angeles';
    expect(formatDate(new Date('2026-11-07T03:00:00Z'))).toBe('2026-11-06');
  });
});
