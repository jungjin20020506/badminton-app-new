import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../lib/constants';

// ===================================================================================
// [인앱 브라우저 감지] 카카오톡·라인 등 '앱 안의 브라우저'인지 판별
// -----------------------------------------------------------------------------------
// 각 앱이 고유하게 남기는 토큰만 본다. 'line', 'naver' 같은 짧은 조각을 그냥 포함 검사하면
// 그 글자가 우연히 들어간 안드로이드 기기 모델명을 쓰는 사람이 정상 브라우저인데도 갇힌다.
//   · kakaotalk        카카오톡          (UA 예: "... KAKAOTALK 10.4.3")
//   · line/            라인              ("... Line/14.5.0" — 'linux'에 안 걸리도록 슬래시까지 확인)
//   · instagram        인스타그램
//   · naver(inapp      네이버 앱          (네이버 웨일 브라우저는 이 토큰이 없어 통과된다)
//   · everytime        에브리타임
// '그냥 여기서 계속할게요'를 누른 기록은 sessionStorage 에 남겨 새로고침해도 다시 뜨지 않는다.
// ===================================================================================
export const IN_APP_BROWSER_RE = /kakaotalk|\bline\/|instagram|naver\(inapp|everytime/i;

export function useInAppBrowser() {
    const [isInAppBrowser, setIsInAppBrowser] = useState(false);

    useEffect(() => {
        let skipped = false;
        try { skipped = sessionStorage.getItem(STORAGE_KEYS.inAppSkip) === '1'; } catch { /* 무시 */ }
        if (skipped) return;
        setIsInAppBrowser(IN_APP_BROWSER_RE.test(navigator.userAgent));
    }, []);

    const dismiss = useCallback(() => {
        try { sessionStorage.setItem(STORAGE_KEYS.inAppSkip, '1'); } catch { /* 무시 */ }
        setIsInAppBrowser(false);
    }, []);

    return [isInAppBrowser, dismiss];
}
