import React, { useEffect, useRef, useState } from 'react';

// ===================================================================================
// [자동매칭 v2] 관리자 게임형 안내 — 직접 눌러보면서 배운다
// -----------------------------------------------------------------------------------
// 글로 설명하는 대신, 실제 화면과 똑같이 생긴 "연습 화면"에 가상 선수들을 세워두고
// 관리자가 진짜처럼 버튼을 눌러가며 배운다. 게임 튜트리얼처럼:
//   ① 👨 남자 매칭을 직접 누른다 → ② 후보 6개 화면을 한 칸씩 배운다(코치 말풍선)
//   → ③ 베스트 카드를 직접 골라본다 → ④ 경기가 끝나 START가 켜지는 걸 직접 본다
//
// [무조건 보게 만드는 방법]
//   끝까지 하고 '확인했습니다'를 눌러야만 '봤음' 기록이 남는다.
//   중간에 닫으면 기록이 남지 않아 다음 접속 때 다시 뜬다. 전체 1분이면 끝난다.
//   다시 보기: 프로필 메뉴 ▸ 🤖 자동매칭 새 기능
// ===================================================================================

/** 시청 기록 키 — players/<id>.tutorialSeen 안에 이 이름으로 저장된다 */
const AUTOMATCH_GUIDE_KEY = 'automatch-v2';

// ───────────────────────────────────────────────────────────────────────────────────
// 가상 선수들 (연습 화면 전용 — 실제 데이터와 무관)
// ───────────────────────────────────────────────────────────────────────────────────

const WAITING_DEMO = [
    { name: '김민수', level: 'A', games: 2 },
    { name: '박지훈', level: 'B', games: 3 },
    { name: '나상호', level: 'B', games: 3 },
    { name: '신환종', level: 'C', games: 3 },
    { name: '이상민', level: 'C', games: 3 },
    { name: '최유진', level: 'D', games: 2 },
    { name: '오세훈', level: 'C', games: 4 },
    { name: '강태오', level: 'D', games: 4 },
];

// 후보 6개 (베스트 2 · 보통 2 · 아쉬움 2) — 첫 번째 베스트에 '경기중' 선수를 넣어
// "경기중 선수도 뽑을 수 있다"를 고르는 과정에서 자연스럽게 배우게 한다.
const OPTIONS_DEMO = [
    {
        tier: 'best', emoji: '🏆', label: '베스트', waitChip: '3번 코트 대기',
        team: [
            { name: '정형진', level: 'B', games: 3, playing: true },
            { name: '나상호', level: 'B', games: 3 },
            { name: '신환종', level: 'C', games: 3 },
            { name: '이상민', level: 'C', games: 3 },
        ],
        reasons: [
            { tone: 'good', text: '4명 모두 오늘 처음 만나는 조합!' },
            { tone: 'good', text: '4명 모두 3경기로 딱 같아요' },
            { tone: 'wait', text: '3번 코트 끝나면 시작 (곧 끝나요) — 경기중: 정형진' },
        ],
    },
    {
        tier: 'best', emoji: '🏆', label: '베스트',
        team: [
            { name: '김민수', level: 'A', games: 2 },
            { name: '최유진', level: 'D', games: 2 },
            { name: '박지훈', level: 'B', games: 3 },
            { name: '이상민', level: 'C', games: 3 },
        ],
        reasons: [
            { tone: 'good', text: '가장 적게 친 선수 포함: 김민수·최유진 (2경기)' },
            { tone: 'mid', text: '겹치는 짝: 박지훈·이상민 (나머지 5쌍은 처음)' },
            { tone: 'good', text: '양 팀 급수 합이 똑같아요' },
        ],
    },
    {
        tier: 'normal', emoji: '👍', label: '보통',
        team: [
            { name: '박지훈', level: 'B', games: 3 },
            { name: '오세훈', level: 'C', games: 4 },
            { name: '신환종', level: 'C', games: 3 },
            { name: '강태오', level: 'D', games: 4 },
        ],
        reasons: [
            { tone: 'mid', text: '겹치는 짝: 신환종·오세훈 (나머지 4쌍은 처음)' },
            { tone: 'mid', text: '경기 수 3~4경기로 비슷' },
            { tone: 'mid', text: '급수는 그럭저럭 맞아요' },
        ],
    },
    {
        tier: 'normal', emoji: '👍', label: '보통',
        team: [
            { name: '김민수', level: 'A', games: 2 },
            { name: '나상호', level: 'B', games: 3 },
            { name: '오세훈', level: 'C', games: 4 },
            { name: '이상민', level: 'C', games: 3 },
        ],
        reasons: [
            { tone: 'mid', text: '겹치는 짝: 나상호·이상민 (나머지 4쌍은 처음)' },
            { tone: 'mid', text: '경기 수 2~4경기로 비슷' },
            { tone: 'good', text: '양 팀 급수 합이 똑같아요' },
        ],
    },
    {
        tier: 'bad', emoji: '⚠️', label: '아쉬움',
        team: [
            { name: '오세훈', level: 'C', games: 4 },
            { name: '강태오', level: 'D', games: 4 },
            { name: '박지훈', level: 'B', games: 3 },
            { name: '최유진', level: 'D', games: 2 },
        ],
        reasons: [
            { tone: 'bad', text: '방금 같은 팀이었던 짝: 오세훈·강태오' },
            { tone: 'bad', text: '경기 수 2~4경기 — 차이가 커요' },
            { tone: 'bad', text: '급수가 한쪽으로 기울어요' },
        ],
    },
    {
        tier: 'bad', emoji: '⚠️', label: '아쉬움',
        team: [
            { name: '김민수', level: 'A', games: 2 },
            { name: '신환종', level: 'C', games: 3 },
            { name: '나상호', level: 'B', games: 3 },
            { name: '강태오', level: 'D', games: 4 },
        ],
        reasons: [
            { tone: 'bad', text: '방금 같은 팀이었던 짝: 나상호·강태오' },
            { tone: 'mid', text: '경기 수 2~4경기로 비슷' },
            { tone: 'bad', text: '급수가 한쪽으로 기울어요' },
        ],
    },
];

// ───────────────────────────────────────────────────────────────────────────────────
// 예시용 부품 — 실제 화면과 똑같은 CSS 클래스를 그대로 쓴다 (그래야 진짜처럼 보인다)
// ───────────────────────────────────────────────────────────────────────────────────

const LEVEL_COLORS = { A: '#FF4F4F', B: '#FF9100', C: '#FFD600', D: '#00E676' };

/** 실제 선수 카드와 같은 모양의 예시 카드 */
function DemoPlayerCard({ name, level, games, gender = '남', playing = false }) {
    const levelColor = LEVEL_COLORS[level] || '#A1A1AA';
    return (
        <div
            className={`player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 w-full ${playing ? 'cox-card-playing' : ''}`}
            style={{
                boxShadow: `inset 4px 0 0 0 ${gender === '남' ? '#3B82F6' : '#EC4899'}`,
                border: '1px solid transparent',
                opacity: playing ? 0.72 : 1,
                transition: 'all .35s ease',
            }}
        >
            <div>
                <div className="player-name text-white text-xs font-bold whitespace-nowrap leading-tight tracking-tighter">{name}</div>
                <div className="player-info text-gray-400 text-[10px] leading-tight mt-px whitespace-nowrap">
                    <span style={{ color: levelColor, fontWeight: 'bold', fontSize: 14, textShadow: `0 0 5px ${levelColor}` }}>{level}</span>
                    <span className="ml-1 text-gray-300 font-bold">{games}G</span>
                </div>
            </div>
            {playing && <span className="cox-playing-tag">경기중</span>}
        </div>
    );
}

/** 선택지 카드 안의 작은 선수 칩 */
function DemoChip({ name, level, games, playing, hi }) {
    const levelColor = LEVEL_COLORS[level] || '#A1A1AA';
    return (
        <div className={`mo-chip ${playing ? 'playing' : ''} ${hi ? 'amg2-hi' : ''}`}>
            <div className="mo-chip-name">{name}</div>
            <div className="mo-chip-sub">
                <span style={{ color: playing ? '#9aa0aa' : levelColor }}>{level}</span>
                <span className="mo-chip-games">{games}G</span>
            </div>
            {playing && <span className="mo-chip-tag">경기중</span>}
        </div>
    );
}

/** 실제 선택지 카드와 같은 모양의 예시 (배울 부분만 밝게 비출 수 있다) */
function DemoOptionCard({ opt, dim, hi, hiReasons, hiChipName, clickable, onPick }) {
    return (
        <div className={`${dim ? 'amg2-dim' : ''} ${hi || clickable ? 'amg2-hi' : ''} ${clickable ? 'amg2-fingerbox' : ''}`}>
            {clickable && <div className="amg2-finger">👇</div>}
            <button
                type="button"
                className={`mo-card ${opt.tier}`}
                style={{ cursor: clickable ? 'pointer' : 'default', width: '100%' }}
                onClick={clickable ? onPick : undefined}
            >
                <div className="mo-card-head">
                    <span className="mo-tier">{opt.emoji} {opt.label}</span>
                    {opt.waitChip && <span className="mo-wait-chip">⏳ {opt.waitChip}</span>}
                </div>
                <div className="mo-teams">
                    <div className="mo-team">
                        {opt.team.slice(0, 2).map(p => <DemoChip key={p.name} {...p} hi={hiChipName === p.name} />)}
                    </div>
                    <div className="mo-vs">VS</div>
                    <div className="mo-team">
                        {opt.team.slice(2, 4).map(p => <DemoChip key={p.name} {...p} hi={hiChipName === p.name} />)}
                    </div>
                </div>
                <ul className={`mo-reasons ${hiReasons ? 'amg2-hi' : ''}`} style={hiReasons ? { padding: '6px 8px' } : undefined}>
                    {opt.reasons.map((r, i) => <li key={i} className={`tone-${r.tone}`}>{r.text}</li>)}
                </ul>
            </button>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────────
// 본체 — 게임 튜트리얼 진행
//   stage: intro(표지) → press(버튼 누르기) → options(후보 배우고 고르기)
//        → queue(대기→START 체험) → done(완료)
// ───────────────────────────────────────────────────────────────────────────────────

const STAGE_ORDER = ['intro', 'press', 'options', 'queue', 'done'];

// options 단계에서 코치가 한 칸씩 짚어주는 순서
const OPTION_STEPS = [
    { focus: 0, text: '후보 6개가 나왔어요!\n🏆 금색으로 빛나는 카드가 베스트 — 지금 만들 수 있는 제일 좋은 조합이에요.' },
    { focus: 3, text: '👍 초록 = 보통 · ⚠️ 노랑 = 아쉬움.\n색만 봐도 좋은 순서를 알 수 있어요.' },
    { focus: 0, text: '카드 아래엔 이유가 적혀 있어요.\n초록 줄 = 좋은 점 · 빨간 줄 = 아쉬운 점.' },
    { focus: 0, text: '회색 「경기중」 = 지금 코트에서 뛰는 선수.\n같이 뽑아도 돼요 — 그 경기가 끝나면 자동으로 풀려요.' },
    { focus: 0, text: '마음에 드는 카드를 누르면 그게 다음 경기!\n베스트 카드를 눌러보세요 👇' },
];

function AutoMatchGuide({ userName, onComplete, onDismiss }) {
    const [stage, setStage] = useState('intro');
    const [optStep, setOptStep] = useState(0);
    const [courtDone, setCourtDone] = useState(false); // queue 단계: 3번 코트가 끝났는가
    const bodyRef = useRef(null);
    const cardRefs = useRef([]);

    // 단계가 바뀌면 화면을 맨 위로, options 단계에서는 배우는 카드가 보이게 스크롤
    useEffect(() => {
        if (stage !== 'options') {
            bodyRef.current?.scrollTo?.({ top: 0 });
            return;
        }
        const idx = OPTION_STEPS[optStep]?.focus ?? 0;
        const t = setTimeout(() => {
            cardRefs.current[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 150);
        return () => clearTimeout(t);
    }, [stage, optStep]);

    // ── 코치 말풍선 내용 (단계별) ──
    let coachText = '';
    let coachBtn = null;   // { label, onClick }
    if (stage === 'intro') {
        coachText = `${userName ? `${userName} 관리자님! ` : '관리자님! '}자동매칭이 새로워졌어요.\n글 대신 직접 눌러보면서 배워요. 딱 1분!`;
        coachBtn = { label: '🎮 직접 해보기', onClick: () => setStage('press') };
    } else if (stage === 'press') {
        coachText = '여기는 연습 화면이에요. 가상 선수들이 준비됐어요.\n👨 남자 매칭 버튼을 눌러보세요!';
    } else if (stage === 'options') {
        coachText = OPTION_STEPS[optStep].text;
        if (optStep < OPTION_STEPS.length - 1) {
            coachBtn = { label: '다음', onClick: () => setOptStep(s => s + 1) };
        }
    } else if (stage === 'queue') {
        if (!courtDone) {
            coachText = '골랐어요! 자동 매칭 목록에 들어갔어요 🙌\n정형진 선수가 아직 경기중이라 START가 「대기」로 잠겨 있죠?';
            coachBtn = { label: '▶ 3번 코트 경기 끝내보기', onClick: () => setCourtDone(true) };
        } else {
            coachText = '경기가 끝나자 색이 돌아오고 START가 켜졌어요!\nSTART를 눌러 코트로 보내보세요 👇';
        }
    } else if (stage === 'done') {
        coachText = '이제 진짜 화면에서 그대로 하시면 돼요!';
        coachBtn = { label: '확인했습니다 ✅', onClick: onComplete };
    }

    const isPicking = stage === 'options' && optStep === OPTION_STEPS.length - 1;

    return (
        <div className="amg-wrap">
            <div className="amg-sheet">

                {/* ── 머리말 ── */}
                <div className="amg-head">
                    <span className="amg-badge">🚨 관리자 필독</span>
                    <button className="amg-skip" onClick={onDismiss}>나중에 할게요</button>
                </div>

                {/* ── 본문 (단계별 연습 화면) ── */}
                <div className="amg-body" ref={bodyRef}>

                    {stage === 'intro' && (
                        <>
                            <h3 className="amg-title cover" style={{ textAlign: 'center' }}>자동매칭이<br />새로워졌어요!</h3>
                            <div className="amg2-intro-emoji">🎮</div>
                            <p className="amg-lead" style={{ textAlign: 'center' }}>
                                이제 버튼을 누르면 <b className="hl">후보 6개 중에서 골라요.</b>
                                <br />경기중인 선수도 후보에 들어가요.
                            </p>
                            <div className="amg-box warn" style={{ textAlign: 'center' }}>
                                <b>끝까지(1분) 해야 이 안내가 사라져요.</b>
                                <br />중간에 닫으면 다음 접속 때 다시 떠요!
                            </div>
                        </>
                    )}

                    {stage === 'press' && (
                        <>
                            <div className="amg2-stage-label">🎮 연습 화면 — 실제 화면과 똑같아요</div>
                            <div className="amg2-court-chip">
                                <span>🏸</span>
                                <span>3번 코트 경기중: 정형진 · 박준호 vs 김도윤 · 이서준</span>
                            </div>

                            {/* 실제 자동 매칭 섹션과 같은 버튼 3개 — 남자 버튼만 살아 있다 */}
                            <div className="auto-make-row mb-2.5">
                                <div className="amg2-fingerbox">
                                    <div className="amg2-finger">👇</div>
                                    <button
                                        type="button"
                                        className="auto-make-btn male amg2-hi"
                                        style={{ width: '100%' }}
                                        onClick={() => setStage('options')}
                                    >👨 남자 매칭</button>
                                </div>
                                <button type="button" className="auto-make-btn female amg2-dim">👩 여자 매칭</button>
                                <button type="button" className="auto-make-btn mixed amg2-dim">💑 혼복 매칭</button>
                            </div>

                            {/* 가상 대기 명단 */}
                            <section className="bg-gray-800/50 rounded-lg p-2.5">
                                <div className="cox-secline mb-2.5">
                                    <div className="lbl">
                                        <span className="tick"></span>
                                        <span>대기 명단</span>
                                        <span className="count">{WAITING_DEMO.length}</span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 gap-1">
                                    {WAITING_DEMO.map(p => <DemoPlayerCard key={p.name} {...p} />)}
                                </div>
                            </section>
                        </>
                    )}

                    {stage === 'options' && (
                        <>
                            <div className="amg2-stage-label">🎮 연습 화면 — 실제 화면과 똑같아요</div>
                            <h3 className="mo-title" style={{ marginBottom: 2 }}>남자 매칭 고르기</h3>
                            <p className="mo-sub" style={{ marginBottom: 10 }}>후보 12명 · 대기 8명 · 경기중 4명</p>

                            <div className="flex flex-col gap-2">
                                {OPTIONS_DEMO.map((opt, idx) => {
                                    // 지금 배우는 칸만 밝게, 나머지는 흐리게
                                    let dim = false, hi = false, hiReasons = false, hiChipName = null;
                                    if (optStep === 0) { hi = idx === 0; dim = idx !== 0; }
                                    else if (optStep === 1) { hi = idx === 2 || idx === 4; dim = !(idx === 2 || idx === 4); }
                                    else if (optStep === 2) { hiReasons = idx === 0; dim = idx !== 0; }
                                    else if (optStep === 3) { hiChipName = idx === 0 ? '정형진' : null; dim = idx !== 0; }
                                    else if (optStep === 4) { dim = idx !== 0; }
                                    return (
                                        <div key={idx} ref={el => { cardRefs.current[idx] = el; }}>
                                            <DemoOptionCard
                                                opt={opt}
                                                dim={dim}
                                                hi={hi}
                                                hiReasons={hiReasons}
                                                hiChipName={hiChipName}
                                                clickable={isPicking && idx === 0}
                                                onPick={() => { setCourtDone(false); setStage('queue'); }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {stage === 'queue' && (
                        <>
                            <div className="amg2-stage-label">🎮 연습 화면 — 실제 화면과 똑같아요</div>
                            <div className="cox-secline mb-2.5 px-1">
                                <div className="lbl green">
                                    <span className="tick"></span>
                                    <span>🤖 자동 매칭</span>
                                </div>
                            </div>

                            {/* 방금 고른 경기가 목록에 들어간 모습 */}
                            <div className="flex flex-col w-full bg-gray-800/60 rounded-lg p-1">
                                {!courtDone && (
                                    <div className="auto-wait-note">
                                        <span>⏳</span>
                                        <span className="truncate">3번 코트가 끝나면 시작 — 경기중: 정형진</span>
                                    </div>
                                )}
                                <div className="flex items-center w-full gap-1">
                                    <div className="flex-shrink-0 w-8 text-center flex items-center justify-center">
                                        <p className="font-bold text-lg text-white arcade-font">1</p>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                        <DemoPlayerCard name="정형진" level="B" games={3} playing={!courtDone} />
                                        <DemoPlayerCard name="나상호" level="B" games={3} />
                                        <DemoPlayerCard name="신환종" level="C" games={3} />
                                        <DemoPlayerCard name="이상민" level="C" games={3} />
                                    </div>
                                    <div className="flex-shrink-0 w-14 text-center">
                                        {courtDone ? (
                                            <div className="amg2-fingerbox">
                                                <div className="amg2-finger" style={{ fontSize: 22, top: -28 }}>👇</div>
                                                <button
                                                    type="button"
                                                    className="arcade-button w-full py-1.5 px-1 rounded-md font-bold text-[10px] bg-yellow-500 text-black amg2-hi"
                                                    onClick={() => setStage('done')}
                                                >START</button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                className="arcade-button w-full py-1.5 px-1 rounded-md font-bold text-[10px] bg-gray-600 text-gray-400 cursor-not-allowed"
                                                disabled
                                            >대기</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {stage === 'done' && (
                        <>
                            <div className="amg2-party">🎉</div>
                            <h3 className="amg-title" style={{ textAlign: 'center' }}>완벽해요! 이게 전부예요</h3>
                            <div className="amg-flow">
                                <div><span>1</span> 👨👩💑 매칭 버튼 누르기</div>
                                <div><span>2</span> 마음에 드는 카드 <b>골라서 탭</b></div>
                                <div><span>3</span> <b>START</b> 로 코트에 보내기</div>
                                <div><span>4</span> 경기 끝나면 <b>FINISH</b></div>
                            </div>
                            <div className="amg-box tip" style={{ marginTop: 12 }}>
                                <b>🔀 다른 조합</b> = 후보 6개 새로 보기 ·
                                <b> 경기 번호 꾹</b> = 삭제
                                <br />다시 보기: 프로필 메뉴 ▸ <b>🤖 자동매칭 새 기능</b>
                            </div>
                        </>
                    )}
                </div>

                {/* ── 코치 말풍선 + 진행 점 ── */}
                <div className="amg2-coach">
                    <div className="amg2-coach-row">
                        <span className="amg2-coach-emoji">🤖</span>
                        <p className="amg2-coach-text">{coachText}</p>
                    </div>
                    {coachBtn && (
                        <button type="button" className="amg2-coach-btn" onClick={coachBtn.onClick}>
                            {coachBtn.label}
                        </button>
                    )}
                    <div className="amg2-dots">
                        {STAGE_ORDER.map(s => (
                            <span key={s} className={`amg2-dot ${s === stage ? 'on' : ''}`} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export { AutoMatchGuide, AUTOMATCH_GUIDE_KEY };
