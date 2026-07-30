import { getLevelColor } from './helpers';

// ===================================================================================
// [하루 요약 카드] 오늘의 운동 리포트 — 관리자 설정 ▸ 📸 하루 요약 카드
// -----------------------------------------------------------------------------------
// 오늘 참석한 모든 인원(나간 사람·게스트 포함)과 경기 통계를 모아
// 단톡방에 공유할 수 있는 세로형 이미지 카드 한 장을 캔버스로 그린다.
// 공유 버튼 → 폰 공유 시트(카카오톡 선택) / 지원 안 되면 이미지 저장 폴백.
// ===================================================================================

function computeDailySummary(allPlayers) {
    const isToday = (iso) => {
        if (!iso) return false;
        const d = new Date(iso);
        return !isNaN(d) && d.toDateString() === new Date().toDateString();
    };
    // 오늘 참석 = 오늘 입장했거나(entryTime) 오늘 경기 기록이 있는 선수 (테스트 로봇 제외)
    const attendees = Object.values(allPlayers || {}).filter(p =>
        p && p.name && !String(p.id || '').startsWith('Test_') &&
        (isToday(p.entryTime) || (p.todayRecentGames || []).some(g => isToday(g.timestamp)))
    );
    const gamesOf = (p) => (p.todayRecentGames || []).filter(g => isToday(g.timestamp)).length;

    // 총 경기 수: 4명에게 같은 timestamp로 기록되므로 고유 timestamp 개수 = 실제 경기 수
    const tsSet = new Set();
    attendees.forEach(p => (p.todayRecentGames || []).forEach(g => {
        if (!g.isManual && isToday(g.timestamp)) tsSet.add(g.timestamp);
    }));
    const totalPart = attendees.reduce((a, p) => a + gamesOf(p), 0);
    const sorted = [...attendees].sort((a, b) => gamesOf(b) - gamesOf(a) || (a.name || '').localeCompare(b.name || '', 'ko'));
    const ace = sorted[0] && gamesOf(sorted[0]) > 0 ? { name: sorted[0].name, games: gamesOf(sorted[0]) } : null;

    return {
        date: new Date(),
        attendees: sorted.map(p => ({ name: p.name, level: p.level, isGuest: !!p.isGuest, games: gamesOf(p) })),
        memberCount: attendees.filter(p => !p.isGuest).length,
        guestCount: attendees.filter(p => p.isGuest).length,
        maleCount: attendees.filter(p => p.gender === '남').length,
        femaleCount: attendees.filter(p => p.gender === '여').length,
        totalGames: tsSet.size,
        avgGames: attendees.length ? Math.round((totalPart / attendees.length) * 10) / 10 : 0,
        ace,
    };
}

// 요약 카드를 캔버스에 그린다 (세로형, 참석자 수에 따라 높이 자동)
function drawSummaryCard(canvas, s) {
    const W = 1080, PAD = 64;
    const VOLT = '#CDFB47', BG = '#0A0A0C', CARD = '#171A21',
          LINE = 'rgba(255,255,255,0.09)', TEXT = '#F3F5F8', DIM = '#8C93A1';
    const ctx = canvas.getContext('2d');
    const rr = (x, y, w, h, r) => {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
        else ctx.rect(x, y, w, h);
    };

    // ── 참석자 칩 줄 수를 먼저 계산해 캔버스 높이를 정한다 ──
    const chipFont = '700 30px "Noto Sans KR", sans-serif';
    const chipH = 62, chipGapX = 14, chipGapY = 16, innerW = W - PAD * 2;
    ctx.font = chipFont;
    const chips = s.attendees.map(a => {
        const label = a.games > 0 ? `${a.name} ${a.games}` : a.name;
        return { ...a, label, w: Math.ceil(ctx.measureText(label).width) + 74 };
    });
    let rows = chips.length ? 1 : 0, x = 0;
    chips.forEach(c => {
        if (x > 0 && x + c.w > innerW) { rows++; x = 0; }
        x += c.w + chipGapX;
    });

    const chipsStartY = s.ace ? 928 : 812;
    const H = chipsStartY + rows * (chipH + chipGapY) + 172;
    canvas.width = W; canvas.height = H;

    // ── 배경 ──
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let grd = ctx.createRadialGradient(W * 0.2, -100, 0, W * 0.2, -100, 900);
    grd.addColorStop(0, 'rgba(22,50,58,0.75)'); grd.addColorStop(1, 'rgba(22,50,58,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    grd = ctx.createRadialGradient(W, H, 0, W, H, 800);
    grd.addColorStop(0, 'rgba(42,34,16,0.6)'); grd.addColorStop(1, 'rgba(42,34,16,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);

    // ── 헤더 ──
    ctx.fillStyle = VOLT; ctx.fillRect(0, 0, W, 10);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = DIM; ctx.font = '700 24px "Noto Sans KR", sans-serif';
    ctx.fillText('C O C K S L I G H T I N G   O F F I C I A L', PAD, 88);
    ctx.textAlign = 'right';
    ctx.fillText('DAILY REPORT', W - PAD, 88);
    ctx.textAlign = 'left';

    ctx.fillStyle = VOLT; ctx.font = '900 104px "Noto Sans KR", sans-serif';
    ctx.fillText('콕스라이팅', PAD, 212);
    ctx.fillStyle = DIM; ctx.font = '400 34px "Anton", "Noto Sans KR", sans-serif';
    ctx.fillText('TODAY MATCH REPORT', PAD + 6, 262);

    const d = s.date;
    const dateStr = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${['일','월','화','수','목','금','토'][d.getDay()]})`;
    ctx.fillStyle = TEXT; ctx.font = '700 42px "Noto Sans KR", sans-serif';
    ctx.fillText(dateStr, PAD, 340);

    // ── 통계 타일 3개 ──
    const tileY = 400, tileH = 210, tileGap = 22;
    const tileW = (innerW - tileGap * 2) / 3;
    const tiles = [
        { v: `${s.attendees.length}`, u: '명', k: `참석 인원 (남${s.maleCount}·여${s.femaleCount})` },
        { v: `${s.totalGames}`, u: '경기', k: '오늘 총 경기' },
        { v: `${s.avgGames}`, u: '게임', k: '1인 평균' },
    ];
    tiles.forEach((t, i) => {
        const tx = PAD + i * (tileW + tileGap);
        ctx.fillStyle = CARD; rr(tx, tileY, tileW, tileH, 26); ctx.fill();
        ctx.strokeStyle = LINE; ctx.lineWidth = 2; rr(tx, tileY, tileW, tileH, 26); ctx.stroke();
        ctx.fillStyle = i === 0 ? VOLT : TEXT;
        ctx.font = '900 84px "Noto Sans KR", sans-serif';
        const vw = ctx.measureText(t.v).width;
        ctx.fillText(t.v, tx + 34, tileY + 118);
        ctx.fillStyle = DIM; ctx.font = '700 32px "Noto Sans KR", sans-serif';
        ctx.fillText(t.u, tx + 34 + vw + 8, tileY + 116);
        ctx.font = '500 26px "Noto Sans KR", sans-serif';
        ctx.fillText(t.k, tx + 34, tileY + 172);
    });

    // ── 오늘의 에이스 ──
    if (s.ace) {
        const ay = 664, ah = 122;
        ctx.fillStyle = 'rgba(205,251,71,0.10)'; rr(PAD, ay, innerW, ah, 26); ctx.fill();
        ctx.strokeStyle = 'rgba(205,251,71,0.45)'; ctx.lineWidth = 2; rr(PAD, ay, innerW, ah, 26); ctx.stroke();
        ctx.font = '900 46px "Noto Sans KR", sans-serif'; ctx.fillStyle = TEXT;
        ctx.fillText(`🔥 오늘의 에이스  ${s.ace.name}`, PAD + 40, ay + 78);
        ctx.textAlign = 'right'; ctx.fillStyle = VOLT;
        ctx.fillText(`${s.ace.games}경기`, W - PAD - 40, ay + 78);
        ctx.textAlign = 'left';
    }

    // ── 참석 멤버 칩 ──
    ctx.fillStyle = VOLT; ctx.font = '700 27px "Noto Sans KR", sans-serif';
    const label = `TODAY'S PLAYERS · ${s.attendees.length}명${s.guestCount > 0 ? ` (게스트 ${s.guestCount})` : ''}`;
    ctx.fillText(label, PAD, chipsStartY - 34);

    let cx = PAD, cy = chipsStartY;
    chips.forEach(c => {
        if (cx > PAD && cx + c.w > W - PAD) { cx = PAD; cy += chipH + chipGapY; }
        ctx.fillStyle = CARD; rr(cx, cy, c.w, chipH, 31); ctx.fill();
        ctx.strokeStyle = LINE; ctx.lineWidth = 2; rr(cx, cy, c.w, chipH, 31); ctx.stroke();
        // 급수 색 점 (게스트는 하늘색)
        ctx.fillStyle = getLevelColor(c.level, c.isGuest);
        ctx.beginPath(); ctx.arc(cx + 32, cy + chipH / 2, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = TEXT; ctx.font = chipFont;
        ctx.fillText(c.label, cx + 54, cy + chipH / 2 + 11);
        cx += c.w + chipGapX;
    });

    // ── 푸터 ──
    const fy = H - 96;
    ctx.strokeStyle = LINE; ctx.beginPath(); ctx.moveTo(PAD, fy - 42); ctx.lineTo(W - PAD, fy - 42); ctx.stroke();
    ctx.fillStyle = TEXT; ctx.font = '700 34px "Noto Sans KR", sans-serif';
    ctx.fillText('오늘도 함께해서 즐거웠습니다. 다음 운동에서 만나요! 🏸', PAD, fy + 10);
    ctx.fillStyle = DIM; ctx.font = '500 24px "Noto Sans KR", sans-serif';
    ctx.fillText('⚡ COCKSLIGHTING · 실시간 배드민턴 매칭 시스템', PAD, fy + 56);
}

// [하루 요약 카드] 미리보기 + 공유/저장 모달

export { computeDailySummary, drawSummaryCard };