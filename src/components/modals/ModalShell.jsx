import React, { useEffect, useId, useRef } from 'react';

// ===================================================================================
// [모달 셸] 모든 대화상자의 공통 뼈대 — 디자인·접근성·동작을 한 곳에서
// -----------------------------------------------------------------------------------
// 디자인: 토큰(--card, --line-strong, --volt …) 기반의 둥근 카드. tone 으로 테두리 색.
// 접근성:
//  · role="dialog" aria-modal aria-labelledby(제목) — 보조기기가 '대화상자'로 읽는다
//  · 열리면 첫 포커스 대상으로 포커스, Tab/Shift+Tab 은 모달 안에서만 돈다(포커스 가두기)
//  · 닫히면 열기 전 포커스로 되돌린다
//  · Esc 로 닫기, 배경 탭으로 닫기(열린 뒤 600ms 는 무시 — 길게 눌러 연 모달이 바로 닫히는 것 방지)
//  · 안드로이드 뒤로가기(브라우저 back)로 닫기 — 앱이 종료되지 않는다
//  · 열려 있는 동안 뒤 화면 스크롤 잠금
// 사용:
//  <ModalShell title="경기 종료" onClose={…} footer={<><button className="cox-btn ghost">취소</button>…</>}>
//    <p className="cox-modal-text">…</p>
//  </ModalShell>
//  bare 로 쓰면 뼈대(배경·dialog 래퍼·동작)만 주고 안쪽은 전부 children 이 그린다 (매칭 후보 시트 등)
// ===================================================================================

// ── 뒤로가기 처리: 모달이 하나라도 열려 있으면 history 에 상태 하나를 올려 두고,
//    popstate 가 오면 맨 위 모달만 닫는다. 아직 모달이 남아 있으면 상태를 다시 올린다.
const stack = [];
let historyArmed = false;
let ignoreNextPop = 0;
let popInstalled = false;
const HISTORY_STATE = { coxModalLayer: true };

function installPopListener() {
    if (popInstalled || typeof window === 'undefined') return;
    popInstalled = true;
    window.addEventListener('popstate', () => {
        if (ignoreNextPop > 0) { ignoreNextPop -= 1; return; }
        if (!historyArmed) return;
        historyArmed = false;
        const top = stack[stack.length - 1];
        if (top) top.close();
        // 아직 열린 모달이 남아 있으면(혹은 닫히지 않았으면) 다음 뒤로가기도 받게 다시 올린다
        setTimeout(() => {
            if (stack.length > 0 && !historyArmed) { window.history.pushState(HISTORY_STATE, ''); historyArmed = true; }
        }, 0);
    });
}

function pushEntry(entry) {
    installPopListener();
    stack.push(entry);
    if (!historyArmed) {
        try { window.history.pushState(HISTORY_STATE, ''); historyArmed = true; } catch { /* 무시 */ }
    }
}

function removeEntry(entry) {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0 && historyArmed) {
        historyArmed = false;
        ignoreNextPop += 1;
        try { window.history.back(); } catch { ignoreNextPop -= 1; }
    }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;
function lockScroll() {
    scrollLocks += 1;
    if (scrollLocks === 1) document.body.style.overflow = 'hidden';
}
function unlockScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = '';
}

export function ModalShell({
    onClose,
    title,
    subtitle,
    titleClass = '',
    tone = '',             // '' | 'accent' | 'danger'
    size = 'sm',           // 'sm' | 'md' | 'lg'
    sheet = false,         // 모바일에서 아래에서 올라오는 시트
    centered = false,      // 제목 가운데 정렬 (확인/알림)
    showClose = true,
    closeOnBackdrop = true,
    closeOnEscape = true,
    bare = false,
    zIndex = 80,
    className = '',
    bodyClass = '',
    footer = null,
    footerClass = '',
    initialFocusRef = null,
    labelledBy,
    dataTut,
    children,
}) {
    const autoId = useId();
    const titleId = labelledBy || `${autoId}-title`;
    const dialogRef = useRef(null);
    const openedAtRef = useRef(Date.now());
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    const closeOnEscapeRef = useRef(closeOnEscape);
    closeOnEscapeRef.current = closeOnEscape;

    // 열릴 때: 포커스·스크롤 잠금·뒤로가기 등록·키보드(Esc/Tab) 처리. 닫힐 때: 되돌리기
    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const entry = { close: () => closeRef.current?.() };
        pushEntry(entry);
        lockScroll();
        const el = dialogRef.current;
        const focusTarget = initialFocusRef?.current || el?.querySelector('[data-autofocus]') || el?.querySelector(FOCUSABLE) || el;
        // 모달 등장 애니메이션 뒤에 포커스 (iOS 키보드가 레이아웃을 흔드는 것 방지)
        const t = setTimeout(() => { try { focusTarget?.focus({ preventScroll: true }); } catch { /* 무시 */ } }, 30);

        // 키보드는 document 에서 받는다 — 터치 기기에서는 포커스가 body 에 머무는 일이 많아
        // 대화상자 요소의 onKeyDown 만으로는 Esc 가 닿지 않는다. 맨 위 모달만 처리한다.
        const onDocKeyDown = (e) => {
            if (stack[stack.length - 1] !== entry) return;
            if (e.key === 'Escape') {
                if (closeOnEscapeRef.current && closeRef.current) { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
                return;
            }
            if (e.key !== 'Tab') return;
            const dialog = dialogRef.current;
            if (!dialog) return;
            const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
            if (items.length === 0) { e.preventDefault(); dialog.focus(); return; }
            const first = items[0];
            const last = items[items.length - 1];
            const inside = dialog.contains(document.activeElement);
            if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onDocKeyDown, true);

        return () => {
            clearTimeout(t);
            document.removeEventListener('keydown', onDocKeyDown, true);
            removeEntry(entry);
            unlockScroll();
            if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
                try { previouslyFocused.focus({ preventScroll: true }); } catch { /* 무시 */ }
            }
        };
    }, [initialFocusRef]);

    const onBackdropClick = (e) => {
        if (!closeOnBackdrop || !closeRef.current) return;
        if (e.target !== e.currentTarget) return;
        if (Date.now() - openedAtRef.current < 600) return; // 길게 눌러 연 직후의 '클릭' 무시
        closeRef.current();
    };

    const dialogProps = {
        ref: dialogRef,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': title || labelledBy ? titleId : undefined,
        tabIndex: -1,
        'data-tut': dataTut,
    };

    if (bare) {
        return (
            <div className={`cox-modal-backdrop ${sheet ? 'sheet' : ''}`} style={{ zIndex }} onClick={onBackdropClick}>
                <div {...dialogProps} className={`cox-modal-bare ${className}`} style={{ outline: 'none', width: '100%', display: 'flex', justifyContent: 'center' }}>
                    {children}
                </div>
            </div>
        );
    }

    return (
        <div className={`cox-modal-backdrop ${sheet ? 'sheet' : ''}`} style={{ zIndex }} onClick={onBackdropClick}>
            <div {...dialogProps} className={`cox-modal ${size} ${tone ? `tone-${tone}` : ''} ${className}`}>
                {(title || showClose) && (
                    <div className={`cox-modal-head ${centered ? 'centered' : ''}`}>
                        <div className="min-w-0">
                            {title && <h2 id={titleId} className={`cox-modal-title ${titleClass}`}>{title}</h2>}
                            {subtitle && <p className="cox-modal-sub">{subtitle}</p>}
                        </div>
                        {showClose && onClose && !centered && (
                            <button type="button" className="cox-modal-x" onClick={onClose} aria-label="닫기">&times;</button>
                        )}
                    </div>
                )}
                <div className={`cox-modal-body ${centered ? 'center' : ''} ${bodyClass}`}>{children}</div>
                {footer && <div className={`cox-modal-foot ${footerClass}`}>{footer}</div>}
            </div>
        </div>
    );
}
