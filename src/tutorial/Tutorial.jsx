import React, { useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { playersRef } from '../lib/firebase';

// ===================================================================================
// [튜트리얼] 첫 접속 온보딩 — 관리자용 / 사용자용
// -----------------------------------------------------------------------------------
// 실제 화면의 해당 부분에 스포트라이트를 비추고 짧은 말풍선으로 핵심만 설명한다.
//   · 관리자용: 관리자 권한을 받고 처음 1회 자동으로 뜬다.
//   · 사용자용: 일반 선수가 처음 입장할 때 뜨고, "듣기 / 괜찮아요" 를 고를 수 있다.
// 시청 여부는 선수 문서(players/<id>.tutorialSeen)에 남고, localStorage는 보조 기록.
// 언제든 프로필 메뉴 ▸ '튜트리얼 다시 보기' 로 재생할 수 있다.
//
// 단계(step) 스펙
//   target       : 스포트라이트 선택자(data-tut). 없으면 화면 중앙 카드
//   surface      : 그 단계에서 열어 둘 화면 ('main' | 'menu' | 'settings' | 'roster')
//   tab          : 모바일에서 전환할 탭 ('matching' | 'inProgress')
//   only         : 'mobile' | 'desktop' — 해당 환경에서만 표시
//   interactive  : true면 화면 조작을 막지 않는다 (직접 해보기 단계)
//   advanceOnTab : 사용자가 이 탭으로 이동하면 자동으로 다음 단계로
// ===================================================================================

const TUT_LS_KEY = (playerId) => `cox-tutorial-seen-${playerId}`;

const readLocalTutorialSeen = (playerId) => {
    try {
        return JSON.parse(localStorage.getItem(TUT_LS_KEY(playerId))) || {};
    } catch (e) {
        return {};
    }
};

// 시청 기록 저장 — 실패해도 튜트리얼 진행을 막지 않는다(로컬 기록은 남는다).
const markTutorialSeen = async (playerId, mode) => {
    if (!playerId || !mode) return;
    const now = new Date().toISOString();
    try {
        localStorage.setItem(TUT_LS_KEY(playerId), JSON.stringify({ ...readLocalTutorialSeen(playerId), [mode]: now }));
    } catch (e) { /* 시크릿 모드 등 */ }
    try {
        await setDoc(doc(playersRef, playerId), { tutorialSeen: { [mode]: now } }, { merge: true });
    } catch (e) {
        console.error('[튜트리얼] 시청 기록 저장 실패:', e);
    }
};

// ── 관리자용 튜트리얼 — 핵심만 짧게 ──
const TUTORIAL_ADMIN_STEPS = [
    {
        title: '화면은 딱 3칸이에요',
        body: (<>
            <b>대기 명단</b> → <b>자동 매칭·경기 예정</b> → <b>경기 진행</b>.
            <br/>선수는 왼쪽에서 오른쪽으로 흘러갑니다. 끝!
        </>),
    },
    {
        target: '[data-tut="waiting"]', tab: 'matching',
        title: '① 대기 명단',
        body: (<>
            <span className="tut-key">탭</span> 선택 ·
            <span className="tut-key">✕</span> 내보내기 ·
            <span className="tut-key">1초 꾹</span> 선수 관리(휴식·게임 수·기록)
        </>),
    },
    {
        target: '[data-tut="auto-make"]', tab: 'matching',
        title: '② 자동 매칭 — 버튼 하나면 끝',
        body: (<>
            <b>남자 / 여자 / 혼복</b> 버튼을 누를 때마다 <b>한 경기</b>가 만들어져요.
            <br/>기준: <em>적게 친 사람 → 안 친 사람 → 급수 맞춤</em>. 혼복은 남1+여1 팀.
        </>),
    },
    {
        target: '[data-tut="auto"]', tab: 'matching',
        title: '만든 경기 다듬기',
        body: (<>
            카드 <span className="tut-key">탭↔탭</span> 자리 교환 ·
            <span className="tut-key">번호 꾹</span> 경기 삭제 ·
            <span className="tut-key">START</span> 경기 시작
        </>),
    },
    {
        target: '[data-tut="scheduled"]', tab: 'matching',
        title: '③ 경기 예정 — 직접 짤 때',
        body: (<>
            대기에서 <b>선수 탭</b> → 여기 <b>빈칸 탭</b>이면 배정 완료.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '④ 경기 진행',
        body: (<>
            <span className="tut-key">FINISH</span> 경기 종료 + 기록 저장
            <br/><span className="tut-key">코트 번호 꾹</span> → 다른 코트 탭 = <b>코트 이동/교환</b>
        </>),
    },
    {
        only: 'mobile', interactive: true, advanceOnTab: 'inProgress', tab: 'matching',
        title: '직접 해보세요! 👈',
        body: (<>
            화면을 <b>왼쪽으로 밀어보세요</b> — 경기 진행 화면으로 넘어갑니다.
            <br/>(오른쪽으로 밀면 다시 돌아와요)
        </>),
    },
    {
        surface: 'menu', target: '[data-tut="menu"]',
        title: '내 메뉴',
        body: (<>
            <b>휴식</b> · <b>관리자 설정</b> · <b>튜트리얼 다시 보기</b> · <b>나가기</b>가 여기 있어요.
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-auto"]',
        title: '설정 — 매칭 민감도만 기억하세요',
        body: (<>
            <b>높음</b> = 안 친 사람 우선(깐깐) · <b>낮음</b> = 바로바로. 모르면 <em>보통</em>.
            <br/>"조합이 없다"고 뜨면 한 단계 낮추면 됩니다.
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-summary"]',
        title: '하루 요약 카드 📸',
        body: (<>
            운동 끝나고 누르면 <b>오늘의 리포트 카드</b>가 만들어져요 → 단톡방에 공유!
            <br/>코트 수·공지·선수 명단·관리자 부여도 모두 이 설정창에 있습니다.
        </>),
    },
    {
        title: '끝! 나머지는 자동이에요 🎉',
        body: (<>
            <b>새벽 2시</b> 초기화 · <b>정모날 18시</b> 참석자 자동 입장.
            <br/>하루 운영 = <em>매칭 만들기 → START → FINISH</em> 반복. 화이팅!
        </>),
    },
];

// ── 사용자용 튜트리얼 — 1분 컷 ──
const TUTORIAL_USER_STEPS = [
    {
        title: '콕스타, 1분이면 배워요',
        body: (<>
            다음 경기 <b>4명을 시스템이 공평하게</b> 정해줍니다.
            <br/>여러분은 <b>화면만 보고 있으면</b> 돼요!
        </>),
    },
    {
        target: '[data-tut="waiting"]', tab: 'matching',
        title: '① 내 카드',
        body: (<>
            <b>주황 테두리</b>가 나예요. <b>3G</b> = 오늘 3경기.
            <br/><b>내 카드를 탭하면</b> 오늘 누구와 쳤는지 기록이 보여요.
            아래 가운데 ⌖ 버튼은 내 카드를 찾아줍니다.
        </>),
    },
    {
        target: '[data-tut="auto"]', tab: 'matching',
        title: '② 자동 매칭 ★',
        body: (<>
            여기 <b>내 이름이 뜨면 다음 경기</b>예요!
            <br/><em>적게 친 사람 먼저 · 안 친 사람과 · 실력 맞춰</em> — 아무도 소외되지 않게 뽑혀요.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '③ 경기 진행',
        body: (<>
            여기 내 이름이 뜨면 <b>그 번호 코트로</b> 가시면 됩니다!
        </>),
    },
    {
        only: 'mobile', interactive: true, advanceOnTab: 'inProgress', tab: 'matching',
        title: '직접 해보세요! 👈',
        body: (<>
            화면을 <b>왼쪽으로 밀어보세요</b> — 경기 진행 화면으로 넘어갑니다.
        </>),
    },
    {
        surface: 'menu', target: '[data-tut="menu"]',
        title: '휴식할 때 · 집에 갈 때',
        body: (<>
            쉴 때는 <b>잠시 휴식하기</b>, 갈 때는 <b>나가기</b>를 꼭!
            <br/>안 누르면 없는 사람이 매칭에 잡혀요.
        </>),
    },
    {
        title: '끝! 즐겁게 운동하세요 🏸',
        body: (<>
            <em>입장 → 화면 보기 → 이름 뜨면 코트로</em>. 이게 전부예요.
            <br/>다시 보기: 내 메뉴 ▸ 튜트리얼 다시 보기
        </>),
    },
];

// [튜트리얼] 시작 화면 — 인사와 함께 들을지 말지 고른다
function TutorialIntroModal({ mode, userName, onStart, onSkip }) {
    const isAdminMode = mode === 'admin';
    return (
        <div className="tut-intro-wrap">
            <div className="tut-intro">
                <div className="emoji">{isAdminMode ? '👑' : '🏸'}</div>
                <span className="who">{isAdminMode ? 'COCKSTAR ADMIN' : 'COCKSTAR GUIDE'}</span>
                {isAdminMode ? (
                    <>
                        <h3>안녕하세요!<br/>콕스타 관리자가 되신 것을<br/>진심으로 축하합니다~</h3>
                        <p>
                            {userName ? `${userName} 님, ` : ''}관리는 어렵지 않아요.
                            <br/><b>딱 1분</b>, 핵심만 짚어드릴게요!
                        </p>
                    </>
                ) : (
                    <>
                        <h3>안녕하세요!<br/>콕스타 개발자 정형진입니다</h3>
                        <p>
                            {userName ? `${userName} 님, ` : ''}반갑습니다 :)
                            <br/>처음이시면 <b>1분짜리 사용법</b>을 보여드릴게요!
                        </p>
                    </>
                )}
                <div className="tut-intro-actions">
                    <button className="tut-btn primary" onClick={onStart}>
                        {isAdminMode ? '관리자 튜트리얼 시작하기' : '튜트리얼 듣기'}
                    </button>
                    <button className="tut-btn ghost" onClick={onSkip}>
                        {isAdminMode ? '나중에 볼게요' : '괜찮아요! 사용해봤어요'}
                    </button>
                </div>
                <p className="tut-foot">나중에 <b>내 메뉴 ▸ 튜트리얼 다시 보기</b>에서 언제든 볼 수 있어요</p>
            </div>
        </div>
    );
}

// [튜트리얼] 스포트라이트 오버레이 — 실제 화면 요소를 비추고 말풍선으로 설명한다
function TutorialOverlay({ mode, steps, stepIndex, prepare, activeTab, onPrev, onNext, onSkip }) {
    const [rect, setRect] = useState(null);
    // [직접 해보기] 단계 진입 직후의 탭 상태로 오작동하지 않도록, 잠깐 기다렸다가 감지를 켠다
    const [armedStep, setArmedStep] = useState(-1);
    const step = steps[stepIndex];

    useEffect(() => {
        if (!step) return;
        let cancelled = false;
        setRect(null);
        prepare(step);

        // 대상 요소가 그려질 때까지 잠깐 기다렸다가(설정창 열기 등) 위치를 잰다.
        // 끝까지 못 찾으면 대상 없는 단계처럼 화면 중앙 카드로 보여준다.
        const measure = (tries) => {
            if (cancelled) return;
            if (!step.target) { setRect(null); return; }
            const el = document.querySelector(step.target);
            if (!el || el.getBoundingClientRect().height === 0) {
                if (tries < 15) setTimeout(() => measure(tries + 1), 70);
                else setRect(null);
                return;
            }
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            // rAF는 탭이 백그라운드면 멈추므로 setTimeout으로 잰다 (scrollIntoView는 즉시 적용됨)
            setTimeout(() => {
                if (cancelled) return;
                const r = el.getBoundingClientRect();
                setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
            }, 50);
        };

        const timer = setTimeout(() => measure(0), 110);
        const onResize = () => measure(0);
        window.addEventListener('resize', onResize);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            window.removeEventListener('resize', onResize);
        };
    }, [step, prepare]);

    // [직접 해보기] 요구한 탭으로 이동하면 자동으로 다음 단계
    useEffect(() => {
        setArmedStep(-1);
        const t = setTimeout(() => setArmedStep(stepIndex), 600);
        return () => clearTimeout(t);
    }, [stepIndex]);

    useEffect(() => {
        if (armedStep !== stepIndex) return;
        const s = steps[stepIndex];
        if (s?.advanceOnTab && activeTab === s.advanceOnTab) {
            const t = setTimeout(onNext, 550); // 전환된 화면을 잠깐 보여준 뒤 진행
            return () => clearTimeout(t);
        }
    }, [armedStep, stepIndex, activeTab, steps, onNext]);

    if (!step) return null;

    const total = steps.length;
    const isLast = stepIndex === total - 1;
    // 대상이 화면 위쪽에 있으면 설명 카드를 아래에, 아래쪽에 있으면 위에 붙인다.
    const atBottom = !rect || (rect.top + rect.height / 2) < window.innerHeight * 0.5;
    const cardPos = !rect ? (step.interactive ? 'at-top' : 'centered') : (atBottom ? 'at-bottom' : 'at-top');

    return (
        <div className="tut-layer">
            {rect && (
                <div
                    className="tut-spot"
                    style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
                />
            )}
            {/* 오버레이 위 조작을 막는 투명막 — '직접 해보기' 단계에서는 막지 않는다 */}
            {!step.interactive && <div className={`tut-block ${rect ? '' : 'solid'}`} />}
            {/* [직접 해보기] 스와이프 손짓 힌트 */}
            {step.interactive && <div className="tut-swipe-hint">👈</div>}

            <div className={`tut-card ${cardPos}`}>
                <div className="tut-top">
                    <span className="tut-badge">{mode === 'admin' ? '👑 관리자 튜트리얼' : '🏸 콕스타 사용법'}</span>
                    <button className="tut-x" onClick={onSkip}>건너뛰기</button>
                </div>
                <h4 className="tut-title">{step.title}</h4>
                <div className="tut-body">{step.body}</div>
                <div className="tut-track"><span style={{ width: `${((stepIndex + 1) / total) * 100}%` }} /></div>
                <div className="tut-actions">
                    <span className="tut-count">{stepIndex + 1} / {total}</span>
                    {stepIndex > 0 && <button className="tut-btn ghost" onClick={onPrev}>이전</button>}
                    <button className="tut-btn primary" onClick={onNext}>{isLast ? '시작하기 🎉' : '다음'}</button>
                </div>
            </div>
        </div>
    );
}

export { readLocalTutorialSeen, markTutorialSeen, TUTORIAL_ADMIN_STEPS, TUTORIAL_USER_STEPS, TutorialIntroModal, TutorialOverlay };
