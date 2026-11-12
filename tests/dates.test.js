import { describe, it, expect } from 'vitest';
import { getDailyResetKey, getKstParts, getWaitResetAt, getWaitStartAt } from '../src/lib/dates.js';

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

describe('getWaitResetAt (저녁 7시 KST 대기 시간 초기화 기준)', () => {
    const T = (s) => new Date(s).getTime();
    it('19:00 이후면 오늘 19:00', () => {
        expect(getWaitResetAt(T('2026-11-12T20:10:00+09:00'))).toBe(T('2026-11-12T19:00:00+09:00'));
        expect(getWaitResetAt(T('2026-11-12T19:00:00+09:00'))).toBe(T('2026-11-12T19:00:00+09:00')); // 정각 포함
        expect(getWaitResetAt(T('2026-11-12T23:59:00+09:00'))).toBe(T('2026-11-12T19:00:00+09:00'));
    });
    it('19:00 이전이면 어제 19:00 (자정 넘긴 새벽 포함)', () => {
        expect(getWaitResetAt(T('2026-11-12T18:59:00+09:00'))).toBe(T('2026-11-11T19:00:00+09:00'));
        expect(getWaitResetAt(T('2026-11-13T00:30:00+09:00'))).toBe(T('2026-11-12T19:00:00+09:00'));
        expect(getWaitResetAt(T('2026-11-12T10:00:00+09:00'))).toBe(T('2026-11-11T19:00:00+09:00'));
    });
    it('Date 객체를 넘겨도 되고, 월말·연말 경계도 넘어간다', () => {
        expect(getWaitResetAt(new Date('2027-01-01T01:00:00+09:00'))).toBe(T('2026-12-31T19:00:00+09:00'));
        expect(getWaitResetAt(new Date('2026-12-01T19:30:00+09:00'))).toBe(T('2026-12-01T19:00:00+09:00'));
    });
});

describe('getWaitStartAt (대기 시간을 세기 시작할 시각)', () => {
    const T = (s) => new Date(s).getTime();
    const NOW = T('2026-11-12T20:00:00+09:00');
    it('17:00 에 입장한 선수는 19:00 부터 센다 (일찍 온 시간은 안 쌓임)', () => {
        expect(getWaitStartAt('2026-11-12T17:00:00+09:00', NOW)).toBe(T('2026-11-12T19:00:00+09:00'));
    });
    it('19:30 에 경기를 끝낸 선수는 19:30 부터 센다 (19:00 보다 늦으면 그대로)', () => {
        expect(getWaitStartAt('2026-11-12T19:30:00+09:00', NOW)).toBe(T('2026-11-12T19:30:00+09:00'));
    });
    it('18:30 에 보면(19:00 전) 오늘 17:00 입장은 그대로 17:00', () => {
        expect(getWaitStartAt('2026-11-12T17:00:00+09:00', T('2026-11-12T18:30:00+09:00'))).toBe(T('2026-11-12T17:00:00+09:00'));
    });
    it('시각이 없거나 깨졌으면 null', () => {
        expect(getWaitStartAt(undefined, NOW)).toBe(null);
        expect(getWaitStartAt('', NOW)).toBe(null);
        expect(getWaitStartAt('garbage', NOW)).toBe(null);
    });
});
