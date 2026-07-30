// ===================================================================================
// [사운드 아이덴티티] 콕스타 브랜드 사운드 — WebAudio 합성 (외부 파일 없음)
// -----------------------------------------------------------------------------------
// 시그니처: "볼트 차임" — 5도 위로 튀는 짧은 펜타토닉 톤. 모든 소리가 같은 음계
// (E 메이저 펜타토닉)를 쓰기 때문에 어떤 소리가 연달아 나도 조화롭다.
// 기본은 꺼짐(체육관은 시끄럽다) — 프로필 메뉴 ▸ 효과음에서 켠다. localStorage 저장.
// ===================================================================================

const SOUND_LS_KEY = 'cox-sound-enabled';

let audioCtx = null;
const getCtx = () => {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
    }
    // iOS 등에서 suspended 상태면 사용자 제스처 시점에 깨운다
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
};

export const isSoundEnabled = () => {
    try { return localStorage.getItem(SOUND_LS_KEY) === 'on'; } catch (e) { return false; }
};

export const setSoundEnabled = (on) => {
    try { localStorage.setItem(SOUND_LS_KEY, on ? 'on' : 'off'); } catch (e) { /* 무시 */ }
    if (on) getCtx(); // 켜는 순간(사용자 제스처)에 오디오 컨텍스트를 미리 깨워둔다
};

/**
 * 단일 톤 — 부드러운 어택과 자연스러운 감쇠를 가진 신스 플럭.
 * @param {number} freq 주파수(Hz)
 * @param {number} when 시작 시각(초, ctx.currentTime 기준 오프셋)
 * @param {number} dur 길이(초)
 * @param {object} opt { type, gain, slideTo }
 */
const tone = (ctx, freq, when, dur, opt = {}) => {
    const { type = 'sine', gain = 0.10, slideTo } = opt;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);       // 빠른 어택
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);  // 자연 감쇠
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
};

const play = (fn) => {
    if (!isSoundEnabled()) return;
    const ctx = getCtx();
    if (!ctx) return;
    try { fn(ctx); } catch (e) { /* 사운드 실패는 조용히 */ }
};

// E 메이저 펜타토닉 주파수 (E5 기준)
const E5 = 659.26, Gs5 = 830.61, B5 = 987.77, Cs6 = 1108.73, E6 = 1318.51;

/** 매칭 카드 딜 — 카드 4장이 꽂히는 타이밍에 맞춘 상승 아르페지오 */
export const playDeal = () => play((ctx) => {
    [E5, Gs5, B5, E6].forEach((f, i) => tone(ctx, f, 0.05 + i * 0.17, 0.22, { type: 'triangle', gain: 0.07 }));
});

/** 경기 시작 — 낮은 음에서 볼트처럼 튀어오르는 두 음 */
export const playStart = () => play((ctx) => {
    tone(ctx, E5 / 2, 0, 0.12, { type: 'triangle', gain: 0.09 });
    tone(ctx, B5, 0.09, 0.30, { type: 'sine', gain: 0.10 });
});

/** 경기 종료 — 해결감 있는 마무리 화음 */
export const playFinish = () => play((ctx) => {
    tone(ctx, E5, 0, 0.42, { type: 'sine', gain: 0.07 });
    tone(ctx, Gs5, 0.02, 0.40, { type: 'sine', gain: 0.055 });
    tone(ctx, B5, 0.04, 0.38, { type: 'sine', gain: 0.05 });
    tone(ctx, E6, 0.16, 0.34, { type: 'triangle', gain: 0.05 });
});

/** 라이브 리액션 — 짧고 귀엽게 튀는 팝 */
export const playReaction = () => play((ctx) => {
    tone(ctx, Cs6 / 2, 0, 0.10, { type: 'square', gain: 0.035, slideTo: Cs6 });
    tone(ctx, Cs6, 0.06, 0.14, { type: 'sine', gain: 0.07 });
});
