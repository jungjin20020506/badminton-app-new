import { describe, it, expect } from 'vitest';
import { getMyStatus, splitLineup, listUpcomingMatches } from '../src/lib/myStatus.js';

const NOW = new Date('2026-11-12T20:00:00+09:00').getTime();
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();

const players = {
    me: { id: 'me', name: '나', status: 'active', entryTime: iso(40), todayRecentGames: [{ timestamp: iso(12), partners: ['b'], opponents: ['c', 'd'] }] },
    b: { id: 'b', name: '비', status: 'active' },
    c: { id: 'c', name: '씨', status: 'active' },
    d: { id: 'd', name: '디', status: 'active' },
    e: { id: 'e', name: '이', status: 'active' },
    f: { id: 'f', name: '에프', status: 'active' },
    g: { id: 'g', name: '지', status: 'active' },
};

const baseState = () => ({
    numInProgressCourts: 2,
    inProgressCourts: [null, null],
    autoMatches: {},
    scheduledMatches: {},
});

describe('getMyStatus', () => {
    it('대기 중 — 마지막 경기 끝난 뒤 지난 분과 오늘 경기 수', () => {
        const s = getMyStatus({ me: players.me, gameState: baseState(), activePlayers: players, now: NOW });
        expect(s.kind).toBe('waiting');
        expect(s.waitMin).toBe(12);
        expect(s.gamesToday).toBe(1);
    });

    it('휴식 중이면 다른 모든 상태보다 우선', () => {
        const gs = baseState();
        gs.autoMatches = { 0: ['me', 'b', 'c', 'd'] };
        const s = getMyStatus({ me: { ...players.me, isResting: true }, gameState: gs, activePlayers: players, now: NOW });
        expect(s.kind).toBe('resting');
    });

    it('경기 중 — 코트 번호·경과 분·내 편/상대', () => {
        const gs = baseState();
        gs.inProgressCourts[1] = { players: ['b', 'c', 'me', 'd'], startTime: iso(7) };
        const s = getMyStatus({ me: players.me, gameState: gs, activePlayers: players, now: NOW });
        expect(s.kind).toBe('playing');
        expect(s.courtIndex).toBe(1);
        expect(s.elapsedMin).toBe(7);
        expect(s.lineup.mySide).toBe('B');
        expect(s.lineup.partners).toEqual(['d']);
        expect(s.lineup.opponents).toEqual(['b', 'c']);
        expect(s.waitMin).toBe(0);
    });

    it('예약됨 — 경기중인 동료가 있으면 어느 코트를 몇 분 기다리는지', () => {
        const gs = baseState();
        gs.inProgressCourts[0] = { players: ['e', 'f', 'g', 'b'], startTime: iso(10) };
        gs.autoMatches = { 0: ['c', 'd', 'e', 'f'], 1: ['me', 'b', 'c', 'd'] };
        const s = getMyStatus({ me: players.me, gameState: gs, activePlayers: players, now: NOW });
        expect(s.kind).toBe('queued');
        expect(s.queueType).toBe('auto');
        expect(s.queueIndex).toBe(1);
        expect(s.onCourtIds).toEqual(['b']);
        expect(s.waitCourts).toEqual([0]);
        expect(s.waitEstimateMin).toBe(5);
        expect(s.canStartNow).toBe(false);
    });

    it('예약됨 — 전원 대기 중이고 빈 코트가 있으면 바로 시작 가능', () => {
        const gs = baseState();
        gs.scheduledMatches = { 0: [null, null, null, null], 2: ['b', 'me', 'c', 'd'] };
        const s = getMyStatus({ me: players.me, gameState: gs, activePlayers: players, now: NOW });
        expect(s.kind).toBe('queued');
        expect(s.queueType).toBe('schedule');
        expect(s.queueIndex).toBe(2);
        expect(s.canStartNow).toBe(true);
        expect(s.lineup.partners).toEqual(['b']);
    });

    it('예약됨 — 빠진 선수(휴식·퇴장)와 빈 칸을 알려준다', () => {
        const gs = baseState();
        gs.autoMatches = { 0: ['me', 'zzz', 'c', null] };
        const s = getMyStatus({ me: players.me, gameState: gs, activePlayers: players, now: NOW });
        expect(s.brokenIds).toEqual(['zzz']);
        expect(s.missing).toBe(1);
        expect(s.canStartNow).toBe(false);
    });

    it('[대기 시간 초기화] 17시에 와서 한 경기도 안 쳤어도 20시엔 60분 (19시부터 센다)', () => {
        const me = { ...players.me, entryTime: new Date('2026-11-12T17:00:00+09:00').toISOString(), todayRecentGames: [] };
        const s = getMyStatus({ me, gameState: baseState(), activePlayers: players, now: NOW });
        expect(s.waitMin).toBe(60);
    });

    it('[대기 시간 초기화] 19시 정각엔 모두 0분, 19시 이후 경기 종료 시각은 그대로', () => {
        const at19 = new Date('2026-11-12T19:00:00+09:00').getTime();
        const early = { ...players.me, entryTime: new Date('2026-11-12T17:00:00+09:00').toISOString(), todayRecentGames: [] };
        expect(getMyStatus({ me: early, gameState: baseState(), activePlayers: players, now: at19 }).waitMin).toBe(0);
        expect(getMyStatus({ me: early, gameState: baseState(), activePlayers: players, now: at19 + 5 * 60000 }).waitMin).toBe(5);
        // 19:48 에 경기를 끝낸 사람은 20:00 에 12분 — 초기화와 무관
        expect(getMyStatus({ me: players.me, gameState: baseState(), activePlayers: players, now: NOW }).waitMin).toBe(12);
    });

    it('[대기 시간 초기화] 19시 전(18:30)에는 입장 시각부터 그대로 센다', () => {
        const at1830 = new Date('2026-11-12T18:30:00+09:00').getTime();
        const me = { ...players.me, entryTime: new Date('2026-11-12T17:00:00+09:00').toISOString(), todayRecentGames: [] };
        expect(getMyStatus({ me, gameState: baseState(), activePlayers: players, now: at1830 }).waitMin).toBe(90);
    });

    it('깨진 시각 값이 있어도 NaN 없이 0으로', () => {
        const me = { ...players.me, todayRecentGames: [{ timestamp: 'garbage', partners: [], opponents: [] }] };
        const s = getMyStatus({ me, gameState: baseState(), activePlayers: players, now: NOW });
        expect(s.waitMin).toBe(0);
        expect(Number.isFinite(s.waitMin)).toBe(true);
    });

    it('gameState 가 없어도 터지지 않는다', () => {
        const s = getMyStatus({ me: players.me, gameState: null, activePlayers: players, now: NOW });
        expect(s.kind).toBe('waiting');
    });
});

describe('splitLineup', () => {
    it('왼쪽 2칸이 A, 오른쪽 2칸이 B', () => {
        expect(splitLineup(['a', 'me', 'c', 'd'], 'me')).toEqual({ mySide: 'A', partners: ['a'], opponents: ['c', 'd'] });
        expect(splitLineup(['a', 'b', null, 'me'], 'me')).toEqual({ mySide: 'B', partners: [null], opponents: ['a', 'b'] });
    });
});

describe('listUpcomingMatches', () => {
    it('자동 매칭 먼저, 그 다음 비어 있지 않은 경기 예정만', () => {
        const gs = baseState();
        gs.inProgressCourts[0] = { players: ['e', 'f', 'g', 'b'], startTime: iso(3) };
        gs.autoMatches = { 0: ['me', 'b', 'c', 'd'] };
        gs.scheduledMatches = { 0: [null, null, null, null], 1: ['c', null, 'd', 'zzz'] };
        const rows = listUpcomingMatches(gs, players);
        expect(rows.map((r) => `${r.type}:${r.index}`)).toEqual(['auto:0', 'schedule:1']);
        expect(rows[0].onCourtIds).toEqual(['b']);
        expect(rows[1].missing).toBe(1);
        expect(rows[1].brokenIds).toEqual(['zzz']);
    });
});

import { estimateSchedule, gameMinutesOf } from '../src/lib/myStatus.js';

describe('estimateSchedule — 대기 시간 예측', () => {
    it('빈 코트가 있으면 첫 예정 경기는 0분, 그 다음은 평균 경기 시간 뒤', () => {
        const gs = { numInProgressCourts: 1, inProgressCourts: [null], autoMatches: { 0: ['b', 'c', 'd', 'e'], 1: ['me', 'f', 'g', 'b2'] }, scheduledMatches: {} };
        const est = estimateSchedule({ gameState: gs, activePlayers: players, now: NOW, gameMin: 8 });
        expect(est.byKey['auto:0'].waitMin).toBe(0);
        expect(est.byKey['auto:1'].waitMin).toBe(8);
        expect(est.nextFreeMin).toBe(16);
    });

    it('경기중인 코트의 남은 시간 + 코트 수를 반영한다', () => {
        const gs = {
            numInProgressCourts: 2,
            inProgressCourts: [
                { players: ['b', 'c', 'd', 'e'], startTime: iso(5) }, // 8분 경기 → 3분 뒤 빔
                { players: ['f', 'g', 'x', 'y'], startTime: iso(1) }, // 7분 뒤 빔
            ],
            autoMatches: { 0: ['m1', 'm2', 'm3', 'm4'], 1: ['me', 'n1', 'n2', 'n3'], 2: ['o1', 'o2', 'o3', 'o4'] },
            scheduledMatches: {},
        };
        const est = estimateSchedule({ gameState: gs, activePlayers: players, now: NOW, gameMin: 8 });
        expect(est.byKey['auto:0'].waitMin).toBe(3);   // 1번 코트가 3분 뒤 빔
        expect(est.byKey['auto:0'].courtIndex).toBe(0);
        expect(est.byKey['auto:1'].waitMin).toBe(7);   // 2번 코트가 7분 뒤 빔
        expect(est.byKey['auto:2'].waitMin).toBe(11);  // 1번 코트가 다시 빔 (3 + 8)
        expect(est.nextFreeMin).toBe(15);              // 2번 코트 (7 + 8)
    });

    it('경기중인 선수가 낀 예정 경기는 그 선수의 코트가 빌 때까지 못 시작한다', () => {
        const gs = {
            numInProgressCourts: 2,
            inProgressCourts: [{ players: ['b', 'c', 'd', 'e'], startTime: iso(2) }, null], // 1번 코트 6분 뒤 빔
            autoMatches: { 0: ['me', 'b', 'f', 'g'] }, // b 가 경기중
            scheduledMatches: {},
        };
        const est = estimateSchedule({ gameState: gs, activePlayers: players, now: NOW, gameMin: 8 });
        expect(est.byKey['auto:0'].waitMin).toBe(6);
    });

    it('평균 시간을 넘긴 코트는 30초 뒤에 비는 것으로 본다 (음수 없음)', () => {
        const gs = { numInProgressCourts: 1, inProgressCourts: [{ players: ['b', 'c', 'd', 'e'], startTime: iso(30) }], autoMatches: { 0: ['me', 'f', 'g', 'x'] }, scheduledMatches: {} };
        const est = estimateSchedule({ gameState: gs, activePlayers: players, now: NOW, gameMin: 8 });
        expect(est.byKey['auto:0'].waitMin).toBe(1);
    });

    it('코트가 0개이거나 gameState 가 없어도 터지지 않는다', () => {
        expect(estimateSchedule({ gameState: null, activePlayers: players, now: NOW }).nextFreeAt).toBe(null);
        expect(estimateSchedule({ gameState: { numInProgressCourts: 0, inProgressCourts: [] }, activePlayers: players, now: NOW }).nextFreeAt).toBe(null);
    });

    it('gameMinutesOf — 설정이 없거나 이상하면 8분, 범위는 3~40', () => {
        expect(gameMinutesOf(null)).toBe(8);
        expect(gameMinutesOf({ gameMinutes: 'abc' })).toBe(8);
        expect(gameMinutesOf({ gameMinutes: 12 })).toBe(12);
        expect(gameMinutesOf({ gameMinutes: 1 })).toBe(3);
        expect(gameMinutesOf({ gameMinutes: 99 })).toBe(40);
    });
});
