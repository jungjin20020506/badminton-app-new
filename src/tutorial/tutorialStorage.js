// ===================================================================================
// [튜트리얼] 시청 기록 읽기/저장 (Tutorial.jsx 에서 분리 — 컴포넌트 파일은 컴포넌트만 export)
// -----------------------------------------------------------------------------------
// 선수 문서(players/<id>.tutorialSeen)가 기준이고 localStorage는 오프라인 대비 보조 기록.
// 다시 띄우려면 키 문자열에 버전을 붙인다(예: 'automatch-v2'). 저장된 기록을 지우는
// 방식은 로컬 사본 때문에 새는 기기가 생긴다.
// ===================================================================================
import { doc, setDoc } from 'firebase/firestore';
import { playersRef } from '../lib/firebase';
import { log } from '../lib/logger';

/** 자동매칭 안내 시청 기록 키 — players/<id>.tutorialSeen 안에 이 이름으로 저장된다 */
export const AUTOMATCH_GUIDE_KEY = 'automatch-v2';

const TUT_LS_KEY = (playerId) => `cox-tutorial-seen-${playerId}`;

export const readLocalTutorialSeen = (playerId) => {
    try {
        return JSON.parse(localStorage.getItem(TUT_LS_KEY(playerId))) || {};
    } catch {
        return {};
    }
};

// 시청 기록 저장 — 실패해도 튜트리얼 진행을 막지 않는다(로컬 기록은 남는다).
export const markTutorialSeen = async (playerId, mode, { remote = true } = {}) => {
    if (!playerId || !mode) return;
    const now = new Date().toISOString();
    try {
        localStorage.setItem(TUT_LS_KEY(playerId), JSON.stringify({ ...readLocalTutorialSeen(playerId), [mode]: now }));
    } catch { /* 시크릿 모드 등 */ }
    // [유령 관리자] 선수 문서가 없는 유령 모드는 remote: false로 로컬에만 기록한다
    if (!remote) return;
    try {
        await setDoc(doc(playersRef, playerId), { tutorialSeen: { [mode]: now } }, { merge: true });
    } catch (e) {
        log.error('[튜트리얼] 시청 기록 저장 실패:', e);
    }
};
