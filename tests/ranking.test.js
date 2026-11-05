import { describe, it, expect } from 'vitest';
import { computeRankings, computeAceIds, rankOf } from '../src/lib/ranking.js';

const p = (id, team, wins, losses, extra = {}) => ({ id, name: id, level: 'A조', gender: '남', team, todayWins: wins, todayLosses: losses, status: 'active', ...extra });

describe('computeRankings (청백전 순위)', () => {
    it('승률 → 승수 → 패수 → 이름 순으로 정렬하고 동률은 같은 등수', () => {
        const players = {
            a: p('a', '청', 3, 1), // 75%
            b: p('b', '백', 3, 1), // 75% (동률)
            c: p('c', '청', 2, 2), // 50%
            d: p('d', '백', 0, 0), // 경기 없음 → 맨 아래
        };
        const r = computeRankings(players);
        const overall = r.overall || r.all || r;
        const rows = Array.isArray(overall) ? overall : overall.rows;
        expect(rows[0].rank).toBe(1);
        expect(rows[1].rank).toBe(1);
        expect(rows[2].rank).toBe(3);
        expect(rows[rows.length - 1].id).toBe('d');
        expect(rows[rows.length - 1].rate).toBeNull();
    });

    it('rankOf 는 내 전체 순위와 팀 내 순위를 준다', () => {
        const players = { a: p('a', '청', 3, 1), b: p('b', '백', 1, 3), c: p('c', '청', 2, 2) };
        const r = computeRankings(players);
        const mine = rankOf(r, 'c');
        expect(mine).toBeTruthy();
        expect(mine.overallRank).toBe(2);
        expect(mine.teamRank).toBe(2);
        expect(mine.overallCount).toBe(3);
    });

    it('computeAceIds 는 팀별 최상위 한 명씩을 고른다', () => {
        const players = { a: p('a', '청', 3, 1), b: p('b', '백', 1, 3), c: p('c', '청', 2, 2), d: p('d', '백', 2, 1) };
        const aces = computeAceIds(computeRankings(players));
        expect(aces.has('a')).toBe(true);
        expect(aces.has('d')).toBe(true);
        expect(aces.has('c')).toBe(false);
    });
});
