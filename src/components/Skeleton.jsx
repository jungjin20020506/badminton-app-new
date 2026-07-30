import React from 'react';

// ===================================================================================
// [스켈레톤 로딩] 데이터를 불러오는 동안 실제 화면 구조를 미리 보여주는 자리표시자.
// "LOADING..." 텍스트 대신 카드 자리가 은은하게 반짝여 앱이 더 빠르게 느껴진다.
// ===================================================================================

const SkeletonCards = ({ count }) => (
    <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="sk sk-card" style={{ animationDelay: `${(i % 5) * 0.08}s` }} />
        ))}
    </div>
);

const SkeletonMatchRow = () => (
    <div className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
        <div className="flex-shrink-0 w-8 flex items-center justify-center"><div className="sk sk-num" /></div>
        <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="sk sk-card" />)}
        </div>
        <div className="flex-shrink-0 w-14"><div className="sk sk-btn" /></div>
    </div>
);

export function SkeletonScreen() {
    return (
        <div className="cox-dark text-white min-h-screen font-sans flex flex-col">
            {/* 앱바 자리 */}
            <header className="cox-appbar">
                <div className="cox-appbar-brand">
                    <div className="sk sk-line" style={{ width: 130, height: 11 }} />
                    <div className="sk sk-line" style={{ width: 96, height: 22, marginTop: 8 }} />
                </div>
                <div className="sk sk-avatar" />
            </header>

            <main className="flex-grow flex flex-col gap-3 p-1.5 overflow-hidden">
                {/* 대기 명단 자리 */}
                <section className="bg-gray-800/50 rounded-lg p-2.5">
                    <div className="sk sk-line mb-2.5" style={{ width: 88, height: 13 }} />
                    <div className="flex flex-col gap-2">
                        <SkeletonCards count={10} />
                        <SkeletonCards count={5} />
                    </div>
                </section>

                {/* 자동 매칭 자리 */}
                <section>
                    <div className="sk sk-line mb-2.5 ml-1" style={{ width: 96, height: 13 }} />
                    <div className="flex flex-col gap-2">
                        <SkeletonMatchRow />
                        <SkeletonMatchRow />
                    </div>
                </section>

                {/* 경기 진행 자리 */}
                <section>
                    <div className="sk sk-line mb-2.5 ml-1" style={{ width: 76, height: 13 }} />
                    <div className="flex flex-col gap-2">
                        <SkeletonMatchRow />
                        <SkeletonMatchRow />
                    </div>
                </section>
            </main>
        </div>
    );
}
