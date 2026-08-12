import React, { useState } from 'react';

// ===================================================================================
// [자동매칭 v2] 관리자 필독 안내
// -----------------------------------------------------------------------------------
// 자동 매칭이 크게 바뀌었기 때문에, 관리자가 처음 접속했을 때 이 안내가 한 번 뜬다.
// 글만 있으면 안 읽으므로, 실제 화면과 똑같이 생긴 예시와 직접 눌러보는 시뮬레이션을 넣었다.
//
// [무조건 읽게 만드는 방법]
//   끝까지 보고 '확인했습니다'를 눌러야만 '봤음' 기록이 남는다.
//   중간에 닫으면 기록이 남지 않아 다음 접속 때 다시 뜬다. (표지에 그렇게 안내한다)
//   다시 보고 싶으면 프로필 메뉴 ▸ '🤖 자동매칭 새 기능' 에서 언제든 볼 수 있다.
// ===================================================================================

/** 시청 기록 키 — players/<id>.tutorialSeen 안에 이 이름으로 저장된다 */
const AUTOMATCH_GUIDE_KEY = 'automatch-v2';

// ───────────────────────────────────────────────────────────────────────────────────
// 예시용 부품 — 실제 화면과 똑같은 CSS 클래스를 그대로 쓴다 (그래야 진짜처럼 보인다)
// ───────────────────────────────────────────────────────────────────────────────────

/** 실제 선수 카드와 같은 모양의 예시 카드 */
function DemoPlayerCard({ name, level, games, gender = '남', playing = false }) {
    const levelColor = { A: '#FF4F4F', B: '#FF9100', C: '#FFD600', D: '#00E676' }[level] || '#A1A1AA';
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

/** 실제 선택지 카드와 같은 모양의 예시 */
function DemoOptionCard({ tier, emoji, label, team, reasons, waitChip }) {
    return (
        <div className={`mo-card ${tier}`} style={{ cursor: 'default' }}>
            <div className="mo-card-head">
                <span className="mo-tier">{emoji} {label}</span>
                {waitChip && <span className="mo-wait-chip">⏳ {waitChip}</span>}
            </div>
            <div className="mo-teams">
                <div className="mo-team">
                    {team.slice(0, 2).map((p, i) => <DemoChip key={i} {...p} />)}
                </div>
                <div className="mo-vs">VS</div>
                <div className="mo-team">
                    {team.slice(2, 4).map((p, i) => <DemoChip key={i} {...p} />)}
                </div>
            </div>
            <ul className="mo-reasons">
                {reasons.map((r, i) => <li key={i} className={`tone-${r.tone}`}>{r.text}</li>)}
            </ul>
        </div>
    );
}

function DemoChip({ name, level, games, playing }) {
    const levelColor = { A: '#FF4F4F', B: '#FF9100', C: '#FFD600', D: '#00E676' }[level] || '#A1A1AA';
    return (
        <div className={`mo-chip ${playing ? 'playing' : ''}`}>
            <div className="mo-chip-name">{name}</div>
            <div className="mo-chip-sub">
                <span style={{ color: playing ? '#9aa0aa' : levelColor }}>{level}</span>
                <span className="mo-chip-games">{games}G</span>
            </div>
            {playing && <span className="mo-chip-tag">경기중</span>}
        </div>
    );
}

/** 안내용 작은 상자 */
function Box({ tone = 'plain', title, children }) {
    return (
        <div className={`amg-box ${tone}`}>
            {title && <div className="amg-box-title">{title}</div>}
            <div className="amg-box-body">{children}</div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────────
// 직접 눌러보는 시뮬레이션 — "경기가 끝나면 어떻게 되나"
// ───────────────────────────────────────────────────────────────────────────────────
function FinishSimulation() {
    const [finished, setFinished] = useState(false);

    return (
        <div className="amg-sim">
            <div className="amg-sim-label">🤖 자동 매칭 (예시)</div>

            <div className="flex flex-col w-full bg-gray-800/60 rounded-lg p-1">
                {!finished && (
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
                        <DemoPlayerCard name="정형진" level="B" games={3} playing={!finished} />
                        <DemoPlayerCard name="나채빈" level="B" games={3} />
                        <DemoPlayerCard name="신환종" level="C" games={3} />
                        <DemoPlayerCard name="이상민" level="C" games={3} />
                    </div>
                    <div className="flex-shrink-0 w-14 text-center">
                        <button
                            className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold text-[10px] transition-all duration-300 ${
                                finished ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-gray-400'
                            }`}
                            disabled
                        >{finished ? 'START' : '대기'}</button>
                    </div>
                </div>
            </div>

            <button type="button" className="amg-sim-btn" onClick={() => setFinished(f => !f)}>
                {finished ? '↺ 처음부터 다시 보기' : '▶ 3번 코트 경기가 끝나면?'}
            </button>

            <p className={`amg-sim-caption ${finished ? 'done' : ''}`}>
                {finished
                    ? '✅ 정형진 선수 카드에 색이 돌아오고 「경기중」 딱지가 사라졌어요. START 버튼도 노랗게 켜졌습니다 — 이제 누르면 됩니다!'
                    : '지금 정형진 선수는 3번 코트에서 뛰는 중이라 회색입니다. START도 「대기」로 잠겨 있어요. 위 버튼을 눌러보세요.'}
            </p>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────────
// 안내 페이지들
// ───────────────────────────────────────────────────────────────────────────────────
function buildPages(userName) {
    return [
        // ── 0. 표지 ──
        {
            cover: true,
            title: '자동매칭이 대폭 바뀌었습니다',
            node: (
                <>
                    <p className="amg-lead">
                        {userName ? <b>{userName} 관리자님, </b> : <b>관리자님, </b>}
                        이번 업데이트에서 <b className="hl">자동 매칭이 통째로 새로워졌어요.</b>
                        <br />운영 방식이 달라져서 <b className="hl">꼭 한 번 보셔야 합니다.</b>
                    </p>
                    <div className="amg-cover-list">
                        <div><span>1</span> 버튼을 누르면 <b>후보 6개</b>가 이유와 함께 떠요</div>
                        <div><span>2</span> <b>경기중인 선수도</b> 후보에 들어갑니다</div>
                        <div><span>3</span> 매칭 기준이 훨씬 <b>촘촘</b>해졌어요</div>
                    </div>
                    <Box tone="warn">
                        끝까지 보고 <b>[확인했습니다]</b>를 눌러야 이 안내가 사라집니다.
                        <br />중간에 닫으면 다음 접속 때 다시 떠요. 2분이면 끝나요!
                    </Box>
                </>
            ),
        },

        // ── 1. 무엇이 달라졌나 ──
        {
            title: '무엇이 달라졌나요?',
            node: (
                <>
                    <div className="amg-ba">
                        <div className="amg-ba-col old">
                            <div className="amg-ba-head">예전</div>
                            <ul>
                                <li>버튼 누름 → <b>앱이 정한 1경기</b>가 바로 추가</li>
                                <li>후보는 <b>대기석에 앉은 사람</b>만</li>
                                <li>마음에 안 들면 지우고 다시 누르기</li>
                                <li>"조합이 없다"며 <b>실패 창</b>이 뜸</li>
                            </ul>
                        </div>
                        <div className="amg-ba-arrow">▼</div>
                        <div className="amg-ba-col nw">
                            <div className="amg-ba-head">지금</div>
                            <ul>
                                <li>버튼 누름 → <b>후보 6개 + 이유</b>를 보여줌</li>
                                <li>후보는 <b>접속한 전원</b> (경기중 포함)</li>
                                <li>관리자가 <b>골라서</b> 목록에 추가</li>
                                <li>실패 창 대신 <b>왜 아쉬운지</b> 알려줌</li>
                            </ul>
                        </div>
                    </div>
                    <Box tone="tip" title="한 줄 요약">
                        앱이 <b>혼자 정하던 것</b>을, 이제는 <b>이유를 보여주고 관리자가 고르는 것</b>으로 바꿨습니다.
                    </Box>
                </>
            ),
        },

        // ── 2. 후보 범위 ──
        {
            title: '누가 후보에 들어가나요?',
            node: (
                <>
                    <div className="amg-pool">
                        <div className="amg-pool-row ok">
                            <span className="amg-pool-mark">✅</span>
                            <div><b>대기 명단</b>에 있는 선수<div className="sub">예전에도 후보였어요</div></div>
                        </div>
                        <div className="amg-pool-row ok new">
                            <span className="amg-pool-mark">✅</span>
                            <div><b>지금 경기중</b>인 선수 <span className="amg-new">NEW</span>
                                <div className="sub">코트에서 뛰는 중이어도 후보가 됩니다</div>
                            </div>
                        </div>
                        <div className="amg-pool-row no">
                            <span className="amg-pool-mark">❌</span>
                            <div><b>이미 다음 경기가 잡힌</b> 선수<div className="sub">자동 매칭·경기 예정 목록에 이름이 있는 사람</div></div>
                        </div>
                        <div className="amg-pool-row no">
                            <span className="amg-pool-mark">❌</span>
                            <div><b>휴식 중</b>이거나 <b>나간</b> 선수<div className="sub">예전과 동일</div></div>
                        </div>
                    </div>
                    <Box tone="tip" title="왜 이렇게 바꿨나요?">
                        예전에는 <b>경기를 적게 친 사람이 마침 코트에 있으면</b> 후보에서 통째로 빠졌어요.
                        그 사이에 대기석 사람들끼리 다음 경기가 짜여서 <b>계속 밀리는</b> 문제가 있었습니다.
                        이제는 코트에 있어도 후보라서 밀리지 않습니다.
                    </Box>
                </>
            ),
        },

        // ── 3. 선택지 화면 ──
        {
            title: '선택지 6개가 이렇게 떠요',
            node: (
                <>
                    <p className="amg-desc">
                        <b>베스트 2 · 보통 2 · 아쉬움 2</b> = 총 6개. 색으로 바로 구분됩니다.
                        <br />카드를 <b>탭하면</b> 그 조합이 자동 매칭 목록에 들어갑니다.
                    </p>
                    <div className="amg-optlist">
                        <DemoOptionCard
                            tier="best" emoji="🏆" label="베스트"
                            team={[
                                { name: '정형진', level: 'B', games: 3 },
                                { name: '신환종', level: 'B', games: 3 },
                                { name: '나채빈', level: 'C', games: 3 },
                                { name: '오미리', level: 'C', games: 3 },
                            ]}
                            reasons={[
                                { tone: 'good', text: '4명 모두 오늘 처음 만나는 조합!' },
                                { tone: 'good', text: '4명 모두 3경기로 딱 같아요' },
                                { tone: 'good', text: '양 팀 급수 합이 똑같아요' },
                            ]}
                        />
                        <DemoOptionCard
                            tier="normal" emoji="👍" label="보통"
                            team={[
                                { name: '이상민', level: 'A', games: 4 },
                                { name: '윤지혜', level: 'C', games: 3 },
                                { name: '이정문', level: 'B', games: 4 },
                                { name: '오미리', level: 'B', games: 3 },
                            ]}
                            reasons={[
                                { tone: 'mid', text: '겹치는 짝: 이상민·이정문 (나머지 4쌍은 처음)' },
                                { tone: 'mid', text: '경기 수 3~4경기로 비슷' },
                                { tone: 'good', text: '급수 맞는 경기가 필요했던 선수: 이상민 ✨' },
                            ]}
                        />
                        <DemoOptionCard
                            tier="bad" emoji="⚠️" label="아쉬움"
                            team={[
                                { name: '정형진', level: 'B', games: 5 },
                                { name: '나채빈', level: 'D', games: 5 },
                                { name: '신환종', level: 'A', games: 4 },
                                { name: '윤지혜', level: 'D', games: 5 },
                            ]}
                            reasons={[
                                { tone: 'bad', text: '방금 같은 팀이었던 짝: 정형진·나채빈' },
                                { tone: 'bad', text: '경기 수 4~5경기 — 차이가 커요' },
                                { tone: 'bad', text: '급수가 한쪽으로 기울어요' },
                            ]}
                        />
                    </div>
                </>
            ),
        },

        // ── 4. 이유 읽는 법 ──
        {
            title: '이유 문장 읽는 법',
            node: (
                <>
                    <p className="amg-desc">각 줄의 <b>색깔</b>만 봐도 좋은지 나쁜지 바로 알 수 있어요.</p>
                    <div className="amg-legend">
                        <div className="amg-legend-row">
                            <span className="dot good" />
                            <div>
                                <span className="tone-good">초록</span> — 좋은 점
                                <div className="ex">“4명 모두 오늘 처음 만나는 조합!”</div>
                            </div>
                        </div>
                        <div className="amg-legend-row">
                            <span className="dot mid" />
                            <div>
                                <span className="tone-mid">회색</span> — 그럭저럭
                                <div className="ex">“경기 수 3~4경기로 비슷”</div>
                            </div>
                        </div>
                        <div className="amg-legend-row">
                            <span className="dot bad" />
                            <div>
                                <span className="tone-bad">빨강</span> — 아쉬운 점
                                <div className="ex">“방금 같은 팀이었던 짝: 정형진·나채빈”</div>
                            </div>
                        </div>
                        <div className="amg-legend-row">
                            <span className="dot wait" />
                            <div>
                                <span className="tone-wait">파랑</span> — 기다려야 함
                                <div className="ex">“3번 코트 끝나야 시작 (약 6분) — 경기중: 정형진”</div>
                            </div>
                        </div>
                    </div>
                    <Box tone="tip" title="이유에는 항상 3~4줄이 나와요">
                        ① 누구랑 겹치는지 ② 경기 수가 공평한지 ③ 급수가 맞는지
                        ④ (경기중 선수가 있으면) 몇 번 코트를 얼마나 기다려야 하는지
                    </Box>
                </>
            ),
        },

        // ── 5. 시뮬레이션 ──
        {
            title: '경기중인 선수가 뽑히면?',
            node: (
                <>
                    <p className="amg-desc">
                        경기중인 선수가 포함되면 그 카드는 <b>회색 + 「경기중」</b> 딱지가 붙고,
                        START는 <b>「대기」</b>로 잠깁니다. <b>직접 눌러보세요 👇</b>
                    </p>
                    <FinishSimulation />
                    <Box tone="tip" title="관리자가 할 일은 없어요">
                        코트 경기가 끝나면 <b>저절로</b> 색이 돌아오고 START가 켜집니다.
                        새로고침하거나 다시 만들 필요 없어요.
                    </Box>
                </>
            ),
        },

        // ── 6. 매칭 기준 ──
        {
            title: '매칭 기준이 촘촘해졌어요',
            node: (
                <>
                    <div className="amg-rank">
                        <div className="amg-rank-row">
                            <span className="n">1</span>
                            <div><b>경기 수가 적은 사람 먼저</b>
                                <div className="sub">경기중인 선수는 <b>지금 치는 경기까지 +1</b>로 계산해서 정확합니다</div>
                            </div>
                        </div>
                        <div className="amg-rank-row">
                            <span className="n">2</span>
                            <div><b>오늘 안 만난 사람끼리</b>
                                <div className="sub">방금 같은 팀이었으면 크게 감점 · 직전 경기 4명 그대로는 아예 제외</div>
                            </div>
                        </div>
                        <div className="amg-rank-row">
                            <span className="n">3</span>
                            <div><b>급수 밸런스</b>
                                <div className="sub">두 팀의 급수 합이 최대한 맞도록 자동 배치</div>
                            </div>
                        </div>
                        <div className="amg-rank-row new">
                            <span className="n">4</span>
                            <div><b>급수 매너리즘 해소</b> <span className="amg-new">NEW</span>
                                <div className="sub">계속 나보다 약한(또는 센) 사람과만 쳤다면, 다음엔 <b>비슷한 급수끼리</b> 붙여줍니다</div>
                            </div>
                        </div>
                    </div>
                    <Box tone="tip" title="예를 들면">
                        A조 선수가 <b>C·D조와 세 판 연속</b> 쳤다면 재미가 없죠.
                        이제 그 선수는 다음 경기에서 <b>A·B조와 만나도록</b> 우선순위가 올라갑니다.
                        이유 문장에 <b className="tone-good">“급수 맞는 경기가 필요했던 선수: ○○ ✨”</b> 로 표시돼요.
                    </Box>
                </>
            ),
        },

        // ── 7. 문제 해결 ──
        {
            title: '이럴 땐 이렇게',
            node: (
                <div className="amg-qa">
                    <div>
                        <div className="q">Q. 베스트인데 이유가 안 좋아요</div>
                        <div className="a">지금 <b>대기 인원이 적어서</b> 그래요. 화면 위 노란 안내를 확인하세요.
                            급하지 않으면 경기가 하나 끝난 뒤 다시 누르면 훨씬 좋아집니다.</div>
                    </div>
                    <div>
                        <div className="q">Q. 6개가 다 마음에 안 들어요</div>
                        <div className="a">아래 <b>🔀 다른 조합</b>을 누르면 다음 6개를 보여줍니다(3페이지).
                            코트 상황이 방금 바뀌었다면 <b>🔄 다시 계산</b>을 누르세요.</div>
                    </div>
                    <div>
                        <div className="q">Q. 잘못 골랐어요</div>
                        <div className="a">자동 매칭 목록에서 <b>경기 번호를 길게 누르면</b> 삭제됩니다. 선수 카드끼리 탭해서 자리 교환도 됩니다.</div>
                    </div>
                    <div>
                        <div className="q">Q. 예약해 둔 선수가 집에 갔어요</div>
                        <div className="a">그 경기는 <b>자동으로 해체</b>되고 남은 선수는 대기 명단으로 돌아옵니다. 관리자가 할 일 없어요.</div>
                    </div>
                    <div>
                        <div className="q">Q. 인원이 부족하대요</div>
                        <div className="a">휴식 중이거나 이미 다음 경기가 잡힌 선수는 빠집니다.
                            목록에 예약이 많이 쌓였으면 먼저 START로 내보내세요.</div>
                    </div>
                </div>
            ),
        },

        // ── 8. 설정 ──
        {
            title: '설정 — 민감도 뜻이 바뀌었어요',
            node: (
                <>
                    <p className="amg-desc">
                        <b>설정 ▸ 🤖 콕스타 자동 매칭 ▸ 매칭 민감도</b>는 이제
                        <b className="hl"> 경기중인 선수를 몇 명까지 미리 예약할지</b>를 정합니다.
                    </p>
                    <div className="amg-sens">
                        <div><b>낮음</b><span>0명</span><div className="sub">지금 대기 중인 사람으로만. 만들면 바로 시작 가능</div></div>
                        <div><b>보통</b><span>1명</span><div className="sub">추천 — 균형이 좋아요</div></div>
                        <div className="hot"><b>높음</b><span>2명</span><div className="sub">공평 우선. 사람이 많은 날 추천</div></div>
                        <div><b>최고</b><span>제한 없음</span><div className="sub">가장 공평. 대신 기다리는 경기가 늘어요</div></div>
                    </div>
                    <Box tone="tip" title="예전의 “조합이 없어요” 창은 사라졌습니다">
                        이제 민감도를 낮춰야 매칭이 되는 일은 없어요. 4명만 있으면 항상 후보가 나옵니다.
                    </Box>
                </>
            ),
        },

        // ── 9. 마무리 ──
        {
            last: true,
            title: '끝! 하루 운영은 이 4단계',
            node: (
                <>
                    <div className="amg-flow">
                        <div><span>1</span> 👨 남자 / 👩 여자 / 💑 혼복 <b>버튼</b></div>
                        <div><span>2</span> 후보 6개 중 <b>하나 고르기</b></div>
                        <div><span>3</span> <b>START</b> 로 코트에 보내기</div>
                        <div><span>4</span> 경기 끝나면 <b>FINISH</b></div>
                    </div>
                    <Box tone="tip" title="다시 보고 싶으면">
                        프로필 메뉴 ▸ <b>🤖 자동매칭 새 기능</b> 에서 언제든 다시 볼 수 있어요.
                    </Box>
                    <p className="amg-lead" style={{ marginTop: 14, textAlign: 'center' }}>
                        오늘도 즐거운 운동 되세요! 🏸
                    </p>
                </>
            ),
        },
    ];
}

// ───────────────────────────────────────────────────────────────────────────────────
// 본체
// ───────────────────────────────────────────────────────────────────────────────────
function AutoMatchGuide({ userName, onComplete, onDismiss }) {
    const [index, setIndex] = useState(0);
    const pages = buildPages(userName);
    const page = pages[index];
    const total = pages.length;
    const isLast = index === total - 1;

    return (
        <div className="amg-wrap">
            <div className="amg-sheet">

                {/* 머리말 */}
                <div className="amg-head">
                    <span className="amg-badge">{page.cover ? '🚨 관리자 필독' : '🤖 자동매칭 새 기능'}</span>
                    <button className="amg-skip" onClick={onDismiss}>
                        {isLast ? '닫기' : '나중에'}
                    </button>
                </div>

                {/* 본문 */}
                <div className="amg-body" key={index}>
                    <h3 className={`amg-title ${page.cover ? 'cover' : ''}`}>{page.title}</h3>
                    {page.node}
                </div>

                {/* 진행 막대 + 버튼 */}
                <div className="amg-foot">
                    <div className="amg-track"><span style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
                    <div className="amg-actions">
                        <span className="amg-count">{index + 1} / {total}</span>
                        {index > 0 && (
                            <button className="amg-btn ghost" onClick={() => setIndex(i => Math.max(0, i - 1))}>이전</button>
                        )}
                        <button
                            className="amg-btn primary"
                            onClick={() => (isLast ? onComplete() : setIndex(i => i + 1))}
                        >
                            {page.cover ? '2분만 투자할게요 →' : isLast ? '확인했습니다 ✅' : '다음'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { AutoMatchGuide, AUTOMATCH_GUIDE_KEY };
