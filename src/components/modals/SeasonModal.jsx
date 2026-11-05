import React from 'react';
import { ModalShell } from './ModalShell';
import { STORAGE_KEYS } from '../../lib/constants';

// ===================================================================================
// [시즌 공지] 입장 시 공지가 있고 오늘 안 봤으면 — 4가지 모드 (simple / text=포스터 / photo / none)
// 고유 디자인(포스터)이라 ModalShell 은 bare 로 쓴다.
// ===================================================================================
export function SeasonModal({ announcement, seasonId, onClose, announcementType, announcementPhotoUrl }) {
    const handleClose = (isHideToday = false) => {
        if (isHideToday) localStorage.setItem(`${STORAGE_KEYS.seenSeasonPrefix}${seasonId}`, new Date().toDateString());
        onClose();
    };

    return (
        <ModalShell bare zIndex={50} onClose={() => handleClose(false)} labelledBy="season-title">
            <div className="bg-[#111] rounded-2xl overflow-hidden w-full max-w-sm text-center shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col border border-white/5">
                <div className="p-3 flex-grow overflow-y-auto max-h-[85vh]">
                    <div className="mb-3">
                        <h3 id="season-title" className="text-xs font-medium text-white/40 tracking-[0.2em] uppercase">Season Announcement</h3>
                    </div>

                    {announcementType === 'simple' ? (
                        <div className="bg-[#151515] p-5 rounded-xl border border-yellow-500/20 shadow-[0_0_15px_rgba(255,224,0,0.1)] min-h-[250px] flex items-center justify-center text-center">
                            <p className="text-white text-base font-sans whitespace-pre-wrap leading-relaxed break-keep">
                                {announcement || '등록된 공지사항이 없습니다.'}
                            </p>
                        </div>
                    ) : (announcementType === 'text' || !announcementType) ? (
                        <div className="poster-wrapper">
                            <div className="poster">
                                <div className="top-line"></div>
                                <div className="top-bar animate-item">
                                    <span className="top-bar-label">COCKSLIGHTING OFFICIAL</span>
                                    <span className="top-bar-label">EST. 2023</span>
                                </div>
                                <div className="hero animate-item delay-1">
                                    <div className="club-name">콕스라이팅</div>
                                    <div className="club-sub">COCKSLIGHTING</div>
                                </div>
                                <div className="section animate-item delay-2">
                                    <div className="section-label"><span className="status-dot"></span>NOTIFICATION</div>
                                    <div className="time-banner">
                                        <span className="time-banner-value">{announcement || '금일 등록된 공지사항이 없습니다.'}</span>
                                    </div>
                                </div>
                                <div className="section animate-item delay-3">
                                    <div className="section-label">EQUIPMENT</div>
                                    <div className="shuttle-list">
                                        <div className="shuttle-item"><div className="shuttle-text">KBB79 · BOBON365 · 삼화블랙 이상</div></div>
                                        <div className="shuttle-item"><div className="shuttle-text text-white/60">개인콕 사용</div></div>
                                    </div>
                                </div>
                                <div className="section animate-item delay-4" style={{ marginTop: '15px' }}>
                                    <div className="section-label">MANNER RULES</div>
                                    <div className="ban-grid">
                                        <div className="ban-item red-ban"><div className="ban-text">비매너</div></div>
                                        <div className="ban-item red-ban"><div className="ban-text">영업행위</div></div>
                                        <div className="ban-item red-ban"><div className="ban-text">남미새/여미새</div></div>
                                        <div className="ban-item"><div className="ban-text">철새</div></div>
                                        <div className="ban-item"><div className="ban-text">텃세</div></div>
                                        <div className="ban-item"><div className="ban-text">승부욕</div></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : announcementType === 'photo' ? (
                        <img src={announcementPhotoUrl} alt="공지사항" className="w-full h-auto rounded-xl shadow-2xl mb-2" fetchPriority="high" loading="eager" />
                    ) : null}
                </div>
                <div className="bg-[#111] p-4 flex flex-col gap-2 border-t border-white/5">
                    <button type="button" onClick={() => handleClose(false)} className="w-full py-3.5 bg-white text-black font-bold rounded-xl hover:bg-yellow-400 transition-all active:scale-95 text-sm min-h-[48px]" data-autofocus>확인했습니다</button>
                    <button type="button" onClick={() => handleClose(true)} className="text-white/30 text-[11px] py-2 min-h-[40px] hover:text-white/60 tracking-tight">오늘 하루 보지 않기</button>
                </div>
            </div>
        </ModalShell>
    );
}
