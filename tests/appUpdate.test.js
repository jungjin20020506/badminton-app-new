import { describe, it, expect } from 'vitest';
import { formatBuild, isNewerBuild, CURRENT_BUILD } from '../src/lib/appUpdate.js';

describe('appUpdate', () => {
    it('formatBuild 는 ISO 빌드 번호를 한국시간 "YYYY.MM.DD HH:mm" 으로', () => {
        expect(formatBuild('2026-11-05T02:55:23.169Z')).toBe('2026.11.05 11:55');
        expect(formatBuild('dev')).toBe('개발 버전');
        expect(formatBuild('')).toBe('개발 버전');
        expect(formatBuild('not-a-date')).toBe('not-a-date');
    });
    it('isNewerBuild 는 서버 값이 있고 내 값과 다를 때만 true', () => {
        expect(isNewerBuild(null)).toBe(false);
        expect(isNewerBuild('')).toBe(false);
        expect(isNewerBuild(CURRENT_BUILD)).toBe(false);
        expect(isNewerBuild('2099-01-01T00:00:00.000Z')).toBe(true);
    });
});
