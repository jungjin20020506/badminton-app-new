import React from 'react';

// ===================================================================================
// [인앱 브라우저 안내] 외부 브라우저로 한 번에 이동
// -----------------------------------------------------------------------------------
//  · 카카오톡: 안드로이드/아이폰 모두 kakaotalk:// 스킴으로 버튼 한 번에 외부 브라우저가 열린다
//  · 라인: 주소 뒤에 openExternalBrowser=1을 붙이면 외부 브라우저로 열린다
//    (이미 시도한 주소면 같은 화면으로 되돌아올 뿐이라 링크 복사로 넘긴다)
//  · 그 외(인스타그램 등)만 링크 복사 안내
//  · 어떤 경우든 '그냥 계속하기'로 지나갈 수 있다 (강제로 막지 않는다)
// ===================================================================================
export function InAppBrowserGuide({ onContinue }) {
    const ua = navigator.userAgent;
    const isKakao = /kakaotalk/i.test(ua);
    const lineTried = window.location.href.includes('openExternalBrowser=1');
    const isLine = /\bline\//i.test(ua) && !lineTried;
    const oneTapOpen = isKakao || isLine;

    /** 링크 복사 — 복사 기능을 못 쓰는 환경에서도 주소를 볼 수 있게 한다 */
    const copyLink = (url) => {
        const manual = () => window.prompt('아래 주소를 길게 눌러 복사한 뒤, 사파리·크롬 주소창에 붙여넣어주세요', url);
        try {
            // navigator.clipboard 는 https 가 아니거나 오래된 웹뷰에서는 아예 없다.
            // `?.` 로만 쓰면 식이 통째로 undefined 가 되어 .catch 도 안 돌고 아무 일도 안 일어난다 → 먼저 확인
            if (!navigator.clipboard?.writeText) { manual(); return; }
            navigator.clipboard.writeText(url)
                .then(() => alert('링크가 복사되었습니다! 사파리(Safari)나 크롬(Chrome) 주소창에 붙여넣어주세요.'))
                .catch(manual);
        } catch { manual(); }
    };

    const openExternal = () => {
        const targetUrl = window.location.href;
        if (isKakao) {
            window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(targetUrl)}`;
        } else if (isLine) {
            const sep = targetUrl.includes('?') ? '&' : '?';
            window.location.href = `${targetUrl}${sep}openExternalBrowser=1`;
        } else {
            copyLink(targetUrl);
        }
    };

    return (
        <div className="cox-dark text-white min-h-screen flex flex-col items-center justify-center font-sans p-6 text-center" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            <div className="bg-gray-800 p-8 rounded-2xl shadow-[0_0_20px_rgba(205,251,71,0.15)] w-full max-w-sm border border-yellow-500/30" role="dialog" aria-labelledby="inapp-title">
                <div className="text-5xl mb-4" aria-hidden="true">🚀</div>
                <h2 id="inapp-title" className="text-xl font-bold text-yellow-400 mb-2">외부 브라우저를 추천해요</h2>
                <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                    카카오톡 등 앱 안의 화면에서는<br />실시간 매칭이 끊길 수 있어요.<br /><br />
                    <span className="text-white font-bold bg-red-500/20 px-2 py-1 rounded">오류 없는 쾌적한 경기 진행</span>을 위해<br />
                    {oneTapOpen ? '아래 버튼 한 번이면 바로 이동해요!' : '외부 브라우저로 접속해주세요!'}
                </p>
                <button type="button" onClick={openExternal} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg text-sm min-h-[48px]">
                    {oneTapOpen ? '외부 브라우저로 열기' : '링크 복사해서 열기'}
                </button>
                {!oneTapOpen && (
                    <p className="text-gray-500 text-[10px] mt-4">
                        우측 상단·하단의 [⋯] 버튼을 누르고<br />'다른 브라우저로 열기'를 선택하셔도 됩니다.
                    </p>
                )}
                <button type="button" onClick={onContinue} className="mt-5 text-gray-500 hover:text-gray-300 text-xs underline underline-offset-2 min-h-[44px] px-3">
                    괜찮아요, 그냥 여기서 계속할게요
                </button>
            </div>
        </div>
    );
}
