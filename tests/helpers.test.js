import { describe, it, expect } from 'vitest';
import {
    generateId, filterTodayGames, getLevelColor, calculateLocations, findQueueLocation, repairMatchQueues,
    getAdminNames, DEFAULT_ADMIN_NAMES, isPlayerUsable,
} from '../src/lib/helpers.js';

const player = (id, extra = {}) => ({ id, name: id, level: 'B조', gender: '남', status: 'active', isResting: false, todayRecentGames: [], ...extra });

describe('generateId', () => {
    it('공백을 밑줄로 바꾼다 (명단·선수 문서 id 규칙)', () => {
        expect(generateId('홍 길동')).toBe('홍_길동');
        expect(generateId('홍길동')).toBe('홍길동');
        expect(generateId('a  b')).toBe('a_b');
    });
});

describe('filterTodayGames', () => {
    it('첫 기록이 오늘이면 그대로, 아니면 전부 비운다', () => {
        const today = new Date().toISOString();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        expect(filterTodayGames([{ timestamp: today }, { timestamp: yesterday }])).toHaveLength(2);
        expect(filterTodayGames([{ timestamp: yesterday }])).toEqual([]);
        expect(filterTodayGames([])).toEqual([]);
        expect(filterTodayGames(undefined)).toEqual([]);
    });
});

describe('getLevelColor', () => {
    it('게스트는 급수와 무관하게 하늘색', () => {
        expect(getLevelColor('A조', true)).toBe('#00BFFF');
        expect(getLevelColor('A조', false)).not.toBe('#00BFFF');
    });
    it('모르는 급수는 회색', () => {
        expect(getLevelColor('X조', false)).toBe('#A1A1AA');
    });
});

describe('getAdminNames', () => {
    it('빈 배열은 무시하고 기본 관리자를 쓴다 (전원 잠김 방지)', () => {
        expect(getAdminNames({ adminNames: [] })).toBe(DEFAULT_ADMIN_NAMES);
        expect(getAdminNames(null)).toBe(DEFAULT_ADMIN_NAMES);
        expect(getAdminNames({ adminNames: ['나'] })).toEqual(['나']);
    });
});

describe('calculateLocations', () => {
    it('대기 / 예정 / 자동 / 코트 위치를 구분한다', () => {
        const players = { a: player('a'), b: player('b'), c: player('c'), d: player('d') };
        const gameState = {
            scheduledMatches: { '0': ['a', null, null, null] },
            autoMatches: { '0': ['b', 'c', null, null] },
            inProgressCourts: [{ players: ['d', null, null, null], startTime: new Date().toISOString() }],
        };
        const loc = calculateLocations(gameState, players);
        expect(loc.a).toEqual({ location: 'schedule', matchIndex: 0, slotIndex: 0 });
        expect(loc.b).toEqual({ location: 'auto', matchIndex: 0, slotIndex: 0 });
        expect(loc.c.location).toBe('auto');
        expect(loc.d).toEqual({ location: 'court', matchIndex: 0, slotIndex: 0 });
    });
    it('빈 입력은 빈 객체', () => {
        expect(calculateLocations(null, {})).toEqual({});
    });
});

describe('repairMatchQueues (교착 해소)', () => {
    const base = () => ({
        a: player('a'), b: player('b'), c: player('c'), d: player('d'),
        e: player('e'), f: player('f'), g: player('g'), h: player('h'),
    });

    it('아무 문제 없으면 바꾸지 않는다', () => {
        const gs = { autoMatches: { '0': ['a', 'b', 'c', 'd'] }, scheduledMatches: { '0': ['e', 'f', 'g', 'h'] } };
        const r = repairMatchQueues(gs, base());
        expect(r.changed).toBe(false);
        expect(r.newState).toEqual(gs);
    });

    it('자동 매칭에 나간 선수가 있으면 그 경기를 통째로 해체하고 재인덱싱한다', () => {
        const players = base();
        players.b.status = 'inactive';
        const gs = { autoMatches: { '0': ['a', 'b', 'c', 'd'], '1': ['e', 'f', 'g', 'h'] }, scheduledMatches: {} };
        const r = repairMatchQueues(gs, players);
        expect(r.changed).toBe(true);
        expect(r.dissolvedCount).toBe(1);
        expect(r.newState.autoMatches).toEqual({ '0': ['e', 'f', 'g', 'h'] });
        expect(r.clearedNames).toContain('b');
    });

    it('경기 예정(수동)은 관리자 의도를 존중해 해당 칸만 비운다', () => {
        const players = base();
        players.f.isResting = true;
        const gs = { autoMatches: {}, scheduledMatches: { '0': ['e', 'f', 'g', 'h'] } };
        const r = repairMatchQueues(gs, players);
        expect(r.changed).toBe(true);
        expect(r.newState.scheduledMatches['0']).toEqual(['e', null, 'g', 'h']);
    });

    it('isPlayerUsable: 활성이고 휴식이 아닐 때만', () => {
        expect(isPlayerUsable(player('x'))).toBe(true);
        expect(isPlayerUsable(player('x', { isResting: true }))).toBe(false);
        expect(isPlayerUsable(player('x', { status: 'inactive' }))).toBe(false);
        expect(isPlayerUsable(undefined)).toBe(false);
    });
});

describe('filterTodayGames (새벽 2시 KST 운영일 기준)', () => {
    const iso = (s) => new Date(s).toISOString();
    it('자정을 넘긴 새벽 1시에도 저녁에 친 경기는 "오늘" 기록이다', () => {
        const games = [{ timestamp: iso('2026-11-12T22:30:00+09:00'), partners: [], opponents: [] }];
        expect(filterTodayGames(games, new Date('2026-11-13T01:00:00+09:00'))).toEqual(games);
    });
    it('새벽 2시가 지나면 어제 기록이라 비운다', () => {
        const games = [{ timestamp: iso('2026-11-12T22:30:00+09:00'), partners: [], opponents: [] }];
        expect(filterTodayGames(games, new Date('2026-11-13T02:00:00+09:00'))).toEqual([]);
    });
    it('비었거나 시각이 깨졌으면 빈 배열', () => {
        expect(filterTodayGames([], new Date())).toEqual([]);
        expect(filterTodayGames(null, new Date())).toEqual([]);
        expect(filterTodayGames([{ timestamp: 'garbage' }], new Date())).toEqual([]);
    });
});

describe('findQueueLocation (경기중이면서 예약된 선수도 예약 칸을 찾는다)', () => {
    const gs = {
        autoMatches: { '0': ['a', 'b', 'c', 'd'], '1': ['e', null, 'f', 'g'] },
        scheduledMatches: { '0': ['h', null, null, 'i'] },
        inProgressCourts: [{ players: ['a', 'x', 'y', 'z'], startTime: new Date().toISOString() }],
    };
    it('코트에 있어도 자동 매칭 칸을 돌려준다 (calculateLocations 는 court 를 돌려준다)', () => {
        expect(findQueueLocation(gs, 'a')).toEqual({ location: 'auto', matchIndex: 0, slotIndex: 0 });
        expect(calculateLocations(gs, { a: player('a') }).a.location).toBe('court');
    });
    it('경기 예정 칸·빈 칸 섞인 줄도 찾는다', () => {
        expect(findQueueLocation(gs, 'f')).toEqual({ location: 'auto', matchIndex: 1, slotIndex: 2 });
        expect(findQueueLocation(gs, 'i')).toEqual({ location: 'schedule', matchIndex: 0, slotIndex: 3 });
    });
    it('예약 칸에 없으면 null', () => {
        expect(findQueueLocation(gs, 'x')).toBe(null);
        expect(findQueueLocation(null, 'a')).toBe(null);
        expect(findQueueLocation(gs, null)).toBe(null);
    });
});
