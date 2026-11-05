import React, { useState, useEffect } from 'react';

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
//   mode         : 'team' | 'normal' — [청백전] 해당 경기 방식일 때만 표시 (없으면 항상)
//   interactive  : true면 화면 조작을 막지 않는다 (직접 해보기 단계)
//   advanceOnTab : 사용자가 이 탭으로 이동하면 자동으로 다음 단계로
// ===================================================================================

// 시청 기록 읽기/저장은 ./tutorialStorage.js

// 단계 정의(TUTORIAL_ADMIN_STEPS / TUTORIAL_USER_STEPS)는 ./tutorialSteps.jsx

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

export { TutorialIntroModal, TutorialOverlay };
