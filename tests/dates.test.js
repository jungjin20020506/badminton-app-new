import { describe, it, expect } from 'vitest';
import { getDailyResetKey, getKstParts } from '../src/lib/dates.js';

describe('getDailyResetKey (새벽 2시 KST 경계)', () => {
    it('01:59 KST 는 전날, 02:00 KST 는 당일 운영일', () => {
        // 2026-11-05 01:59 KST = 2026-11-04 16:59 UTC
        expect(getDailyResetKey(new Date('2026-11-04T16:59:00Z'))).toBe('2026-11-04');
        // 2026-11-05 02:00 KST = 2026-11-04 17:00 UTC
        expect(getDailyResetKey(new Date('2026-11-04T17:00:00Z'))).toBe('2026-11-05');
        // 한낮
        expect(getDailyResetKey(new Date('2026-11-05T03:00:00Z'))).toBe('2026-11-05');
    });
    it('연말·월말 경계도 자연스럽게 넘어간다', () => {
        expect(getDailyResetKey(new Date('2026-12-31T16:30:00Z'))).toBe('2026-12-31'); // 01:30 KST 1/1 → 12/31
        expect(getDailyResetKey(new Date('2026-12-31T17:30:00Z'))).toBe('2027-01-01');
    });
});

describe('getKstParts', () => {
    it('KST 날짜·시각을 돌려준다', () => {
        const parts = getKstParts(new Date('2026-11-05T09:30:00Z')); // 18:30 KST
        expect(parts.dateKey).toBe('2026-11-05');
        expect(parts.dateNumber).toBe(20261105);
        expect(parts.hour).toBe(18);
    });
    it('자정 직후 KST 는 날짜가 바뀐다', () => {
        const parts = getKstParts(new Date('2026-11-05T15:10:00Z')); // 00:10 KST 11/6
        expect(parts.dateKey).toBe('2026-11-06');
        expect(parts.hour).toBe(0);
    });
});
