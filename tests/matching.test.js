import { describe, it, expect } from 'vitest';
import { buildMatchContext, buildCandidatePool, generateMatchOptions, getSensitivity } from '../src/lib/matching.js';

const makePlayers = (n, gender, level = 'B조') => {
    const out = {};
    for (let i = 1; i <= n; i += 1) {
        const id = `${gender}${i}`;
        out[id] = { id, name: id, level, gender, status: 'active', isResting: false, entryTime: new Date(Date.now() - i * 60000).toISOString(), todayRecentGames: [] };
    }
    return out;
};
const emptyState = () => ({ inProgressCourts: [null, null, null, null], autoMatches: {}, scheduledMatches: {}, numInProgressCourts: 4, numScheduledMatches: 4 });

describe('자동 매칭 엔진 (기본 동작)', () => {
    it('남자 8명이면 후보가 나오고 각 후보는 서로 다른 4명이다', () => {
        const players = makePlayers(8, '남');
        const ctx = buildMatchContext(players, emptyState(), { now: Date.now() });
        const pool = buildCandidatePool(ctx, '남');
        const sens = getSensitivity('normal');
        const result = generateMatchOptions({ pool, ctx, mode: '남', maxOnCourt: sens.maxOnCourt, pages: 3, pendingReservations: 0 });
        expect(result.status).toBe('ok');
        expect(result.pages.length).toBeGreaterThan(0);
        for (const option of result.pages[0]) {
            expect(option.ids).toHaveLength(4);
            expect(new Set(option.ids).size).toBe(4);
            option.ids.forEach((id) => expect(players[id].gender).toBe('남'));
        }
    });

    it('3명뿐이면 ok 가 아니다', () => {
        const players = makePlayers(3, '여');
        const ctx = buildMatchContext(players, emptyState(), { now: Date.now() });
        const pool = buildCandidatePool(ctx, '여');
        const result = generateMatchOptions({ pool, ctx, mode: '여', maxOnCourt: 1, pages: 3, pendingReservations: 0 });
        expect(result.status).not.toBe('ok');
    });

    it('혼복은 남 2 + 여 2 로 짜인다', () => {
        const players = { ...makePlayers(4, '남'), ...makePlayers(4, '여') };
        const ctx = buildMatchContext(players, emptyState(), { now: Date.now() });
        const pool = buildCandidatePool(ctx, '혼복');
        const result = generateMatchOptions({ pool, ctx, mode: '혼복', maxOnCourt: 1, pages: 3, pendingReservations: 0 });
        expect(result.status).toBe('ok');
        for (const option of result.pages[0]) {
            const genders = option.ids.map((id) => players[id].gender);
            expect(genders.filter((g) => g === '남')).toHaveLength(2);
            expect(genders.filter((g) => g === '여')).toHaveLength(2);
        }
    });

    it('휴식 중인 선수는 후보에서 빠진다', () => {
        const players = makePlayers(8, '남');
        players['남1'].isResting = true;
        const ctx = buildMatchContext(players, emptyState(), { now: Date.now() });
        const pool = buildCandidatePool(ctx, '남');
        expect(pool.some((p) => p.id === '남1')).toBe(false);
    });
});

describe('[대기 시간 초기화] 저녁 7시(KST)부터 모든 선수의 대기 시간을 다시 센다', () => {
    const T = (s) => new Date(s).getTime();
    const kst = (hhmm) => new Date(`2026-11-12T${hhmm}:00+09:00`).toISOString();

    it('17:00 입장·19:30 입장 선수 모두 20:00 에는 19:00 이후 시간만 센다', () => {
        const players = makePlayers(8, '남');
        players['남1'].entryTime = kst('17:00'); // 일찍 옴 — 예전엔 180분으로 잡혔다
        players['남2'].entryTime = kst('19:30');
        players['남3'].todayRecentGames = [{ timestamp: kst('19:45'), partners: ['남4'], opponents: ['남5', '남6'] }];
        const ctx = buildMatchContext(players, emptyState(), { now: T('2026-11-12T20:00:00+09:00') });
        expect(Math.round(ctx.stats['남1'].waitMin)).toBe(60);
        expect(Math.round(ctx.stats['남2'].waitMin)).toBe(30);
        expect(Math.round(ctx.stats['남3'].waitMin)).toBe(15);
    });

    it('19:00 정각에는 일찍 온 선수도 0분 — 매칭 우선순위에서 이점이 없다', () => {
        const players = makePlayers(8, '남');
        players['남1'].entryTime = kst('16:00');
        players['남2'].entryTime = kst('18:59');
        const ctx = buildMatchContext(players, emptyState(), { now: T('2026-11-12T19:00:00+09:00') });
        expect(ctx.stats['남1'].waitMin).toBe(0);
        expect(ctx.stats['남2'].waitMin).toBe(0);
    });

    it('19:00 전(18:30)에는 입장 시각부터 그대로 센다', () => {
        const players = makePlayers(8, '남');
        players['남1'].entryTime = kst('17:00');
        const ctx = buildMatchContext(players, emptyState(), { now: T('2026-11-12T18:30:00+09:00') });
        expect(Math.round(ctx.stats['남1'].waitMin)).toBe(90);
    });
});
