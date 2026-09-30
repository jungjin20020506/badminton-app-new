// ===================================================================================
// [청백전] 오늘의 순위 · 팀 에이스 계산 (순수 함수 — 화면과 무관)
// -----------------------------------------------------------------------------------
//  정렬: 승률 ↓ → 승수 ↓ → 패수 ↑ → 이름. 경기(승+패)가 0인 선수는 맨 아래(승률 '-').
//  순위는 같은 성적이면 같은 등수(1, 1, 3 …).
// ===================================================================================
import { TEAM_BLUE, TEAM_WHITE, getTeamOf, getWinLoss } from './helpers';

function toRow(p) {
    const { wins, losses } = getWinLoss(p);
    const games = wins + losses;
    return {
        id: p.id, name: p.name, level: p.level, team: getTeamOf(p), gender: p.gender,
        wins, losses, games,
        rate: games > 0 ? Math.round((wins / games) * 100) : null,
        isResting: !!p.isResting,
    };
}

function compareRows(a, b) {
    const ra = a.rate ?? -1, rb = b.rate ?? -1;
    if (ra !== rb) return rb - ra;
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return (a.name || '').localeCompare(b.name || '', 'ko');
}

function sameRecord(a, b) {
    return (a.rate ?? -1) === (b.rate ?? -1) && a.wins === b.wins && a.losses === b.losses;
}

function rankList(rows) {
    const sorted = [...rows].sort(compareRows);
    let rank = 0;
    return sorted.map((r, i) => {
        if (i === 0 || !sameRecord(r, sorted[i - 1])) rank = i + 1;
        return { ...r, rank };
    });
}

/**
 * @param {object} players  활성 선수 맵 (id → player)
 * @returns {{ all: Array, blue: Array, white: Array }} 각 목록은 rank 가 붙은 행 배열
 */
function computeRankings(players) {
    const rows = Object.values(players || {}).filter(p => p && p.name).map(toRow);
    return {
        all: rankList(rows),
        blue: rankList(rows.filter(r => r.team === TEAM_BLUE)),
        white: rankList(rows.filter(r => r.team === TEAM_WHITE)),
    };
}

/** 각 팀에서 성적이 가장 좋은 선수(1승 이상) id 집합 — 동률이면 모두 ⭐ */
function computeAceIds(rankings) {
    const ids = new Set();
    [rankings.blue, rankings.white].forEach(list => {
        list.forEach(r => { if (r.rank === 1 && r.wins >= 1) ids.add(r.id); });
    });
    return ids;
}

/** 특정 선수의 팀 내 / 전체 순위 정보 */
function rankOf(rankings, playerId) {
    const find = (list) => list.find(r => r.id === playerId);
    const all = find(rankings.all);
    if (!all) return null;
    const teamList = all.team === TEAM_BLUE ? rankings.blue : all.team === TEAM_WHITE ? rankings.white : null;
    const team = teamList ? find(teamList) : null;
    return {
        rate: all.rate, wins: all.wins, losses: all.losses,
        overallRank: all.rank, overallCount: rankings.all.length,
        teamRank: team ? team.rank : null, teamCount: teamList ? teamList.length : 0,
    };
}

export { computeRankings, computeAceIds, rankOf, compareRows };
