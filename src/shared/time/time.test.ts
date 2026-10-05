import { describe, it, expect } from 'vitest';
import { TimeUtils } from './time';

describe('TimeUtils', () => {
  it('returns valid ISO string for nowUTC', () => {
    const now = TimeUtils.nowUTC();
    // basic regex for ISO format
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('formats UTC time to a specific timezone', () => {
    const isoString = '2026-10-05T12:00:00.000Z'; // 12:00 UTC
    // In Tokyo (UTC+9), this is 21:00
    const formatted = TimeUtils.formatInTimezone(isoString, 'Asia/Tokyo');
    expect(formatted).toContain('21:00:00');
  });
});
