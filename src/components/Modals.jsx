import React, { useState } from 'react';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { playersRef } from '../lib/firebase';

function SeasonModal({ announcement, seasonId, onClose, announcementType, announcementPhotoUrl }) {
    const handleClose = (isHideToday = false) => {
        if (isHideToday) {
            localStorage.setItem(`seen-${seasonId}`, new Date().toDateString());
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-[#111] rounded-2xl overflow-hidden w-full max-w-sm text-center shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col border border-white/5">
               <div className="p-3 flex-grow overflow-y-auto max-h-[85vh]">
    {/* 상단 공지 헤더 최적화 */}
    <div className="mb-3">
        <h3 className="text-xs font-medium text-white/40 tracking-[0.2em] uppercase">Season Announcement</h3>
    </div>
    
    {announcementType === 'simple' ? (
        <div className="bg-[#151515] p-5 rounded-xl border border-yellow-500/20 shadow-[0_0_15px_rgba(255,224,0,0.1)] min-h-[250px] flex items-center justify-center text-center">
            <p className="text-white text-base font-sans whitespace-pre-wrap leading-relaxed break-keep">
                {announcement || "등록된 공지사항이 없습니다."}
            </p>
        </div>
    ) : (announcementType === 'text' || !announcementType) ? (
        <div className="poster-wrapper">
            <style>{`
                .poster-wrapper {
                  --brand-yellow: #CDFB47;
                  --bg-solid: #0A0A0A;
                  display: flex;
                  justify-content: center;
                  background: transparent;
                  padding: 0;
                  font-family: 'Inter', 'Pretendard', sans-serif;
                }
                .poster-wrapper .poster {
                  width: 100%;
                  background: var(--bg-solid);
                  position: relative;
                  overflow: hidden;
                  border-radius: 12px;
                  display: flex;
                  flex-direction: column;
                  padding-bottom: 20px;
                  box-shadow: inset 0 0 100px rgba(255,224,0,0.05);
                }
                .poster-wrapper .top-line { height: 4px; background: var(--brand-yellow); width: 100%; }
                .poster-wrapper .top-bar { padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .poster-wrapper .top-bar-label { font-size: 9px; letter-spacing: 2px; color: #555; font-weight: 600; }
                .poster-wrapper .hero { padding: 24px 20px 10px; text-align: left; }
                .poster-wrapper .club-name { font-family: 'Black Han Sans', sans-serif; font-size: 48px; line-height: 1; color: var(--brand-yellow); letter-spacing: -1px; margin-bottom: 4px; }
                .poster-wrapper .club-sub { font-size: 14px; font-weight: 300; letter-spacing: 4px; color: rgba(255,255,255,0.4); text-transform: uppercase; }
                .poster-wrapper .section { padding: 0 20px; margin-top: 20px; text-align: left; }
                @keyframes pulse-border {
                  0% { border-color: rgba(255, 224, 0, 0.1); box-shadow: 0 0 0px rgba(255, 224, 0, 0); }
                  50% { border-color: rgba(255, 224, 0, 0.5); box-shadow: 0 0 10px rgba(255, 224, 0, 0.1); }
                  100% { border-color: rgba(255, 224, 0, 0.1); box-shadow: 0 0 0px rgba(255, 224, 0, 0); }
                }
                @keyframes status-blink {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.3; }
                }
                .poster-wrapper .section-label { 
                  font-size: 9px; 
                  letter-spacing: 2px; 
                  color: var(--brand-yellow); 
                  margin-bottom: 10px; 
                  font-weight: 700; 
                  display: flex;
                  align-items: center;
                  gap: 6px;
                }
                .poster-wrapper .status-dot {
                  width: 5px;
                  height: 5px;
                  background-color: #ff4d4d;
                  border-radius: 50%;
                  box-shadow: 0 0 5px #ff4d4d;
                  animation: status-blink 1s infinite;
                }
                .poster-wrapper .time-banner { 
                  background: #151515; 
                  border-radius: 8px; 
                  padding: 14px 18px; 
                  display: flex; 
                  align-items: center; 
                  justify-content: space-between; 
                  border: 1px solid rgba(255,224,0,0.2);
                  animation: pulse-border 3s infinite ease-in-out;
                }
                .poster-wrapper .time-banner-value { 
                  font-family: 'Pretendard', sans-serif; 
                  font-size: 14px; 
                  color: #ffffff; 
                  line-height: 1.6;
                  word-break: keep-all;
                  white-space: pre-wrap;
                  text-shadow: 0 0 1px rgba(255,255,255,0.2);
                }
                
                .poster-wrapper .shuttle-list { display: flex; flex-direction: column; gap: 8px; }
                .poster-wrapper .shuttle-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .poster-wrapper .shuttle-text { font-size: 12px; font-weight: 400; color: #aaa; }
                .poster-wrapper .ban-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 5px; }
                .poster-wrapper .ban-item { background: rgba(255,0,0,0.03); border-radius: 4px; padding: 8px 4px; text-align: center; }
                .poster-wrapper .ban-text { font-size: 10px; font-weight: 500; color: #666; }
                .poster-wrapper .ban-item.red-ban { background: rgba(255,0,0,0.05); }
                .poster-wrapper .ban-item.red-ban .ban-text { color: #844; }
                @keyframes revealUp { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
                .poster-wrapper .animate-item { animation: revealUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
                .poster-wrapper .delay-1 { animation-delay: 0.1s; }
                .poster-wrapper .delay-2 { animation-delay: 0.2s; }
                .poster-wrapper .delay-3 { animation-delay: 0.3s; }
                .poster-wrapper .delay-4 { animation-delay: 0.4s; }
            `}</style>
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
                    <div className="section-label">
                        <span className="status-dot"></span>
                        NOTIFICATION
                    </div>
                    <div className="time-banner">
                        <span className="time-banner-value">{announcement || "금일 등록된 공지사항이 없습니다."}</span>
                    </div>
                </div>
                <div className="section animate-item delay-3">
                    <div className="section-label">EQUIPMENT</div>
                    <div className="shuttle-list">
                        <div className="shuttle-item"><div className="shuttle-text">KBB79 · BOBON365 · 삼화블랙 이상</div></div>
                        <div className="shuttle-item"><div className="shuttle-text text-white/60">개인콕 사용</div></div>
                    </div>
                </div>

                <div className="section animate-item delay-4" style={{marginTop: '15px'}}>
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
        <img 
            src={announcementPhotoUrl} 
            alt="공지사항" 
            className="w-full h-auto rounded-xl shadow-2xl mb-2"
            fetchpriority="high"
            loading="eager"
        />
    ) : null}
</div>
                <div className="bg-[#111] p-4 flex flex-col gap-2 border-t border-white/5">
                    <button onClick={() => handleClose(false)} className="w-full py-3.5 bg-white text-black font-bold rounded-xl hover:bg-yellow-400 transition-all active:scale-95 text-sm">확인했습니다</button>
                    <button onClick={() => handleClose(true)} className="text-white/20 text-[10px] py-1 hover:text-white/40 tracking-tight">오늘 하루 보지 않기</button>
                </div>
            </div>
        </div>
    );
}



function AdminEditPlayerModal({ player, allPlayers, onClose, setModal }) {
    const currentPlayer = allPlayers[player.id] || player;

    const handleToggleRest = async () => {
        await updateDoc(doc(playersRef, player.id), { isResting: !currentPlayer.isResting });
        onClose();
    };

    const handleAdjustGameCount = async (delta) => {
        const currentGames = currentPlayer.todayRecentGames || [];
        let newGames = [...currentGames];
        
        if (delta > 0) {
            newGames.unshift({ timestamp: new Date().toISOString(), partners: [], opponents: [], isManual: true });
        } else if (delta < 0 && newGames.length > 0) {
            newGames.shift();
        }
        
        try {
            await updateDoc(doc(playersRef, player.id), { todayRecentGames: newGames });
        } catch (error) {
            console.error("Game count adjustment failed:", error);
        }
    };

    const handleDeletePermanently = () => {
        setModal({ type: 'confirm', data: { title: '선수 완전 삭제', body: `[경고] ${player.name} 선수를 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
            onConfirm: async () => {
                await deleteDoc(doc(playersRef, player.id));
                onClose();
                setModal({ type: null, data: null });
            }
        }});
    };

    const RecentGamesList = ({ games }) => {
        if (!games || games.length === 0) {
            return <p className="text-sm text-gray-500 text-center">오늘 매칭 기록이 없습니다.</p>;
        }

        const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';

        return (
            <ul className="text-sm space-y-1 max-h-32 overflow-y-auto pr-2">
                {games.map((game, i) => {
                            if (game.isManual) {
                                return (
                                    <li key={i} className="flex flex-col p-2 rounded bg-gray-700/50">
                                        <div className="flex flex-wrap gap-1 items-center">
                                            <span className="text-yellow-400 font-bold" style={{ textShadow: '0 0 8px rgba(250, 204, 21, 0.8)' }}>
                                                {getPlayerName(player.id)}
                                            </span>
                                            <span className="text-gray-400 text-xs ml-2">(수동 조작됨)</span>
                                        </div>
                                    </li>
                                );
                            }

                            const allPlayersInGame = [player.id, ...game.partners, ...game.opponents];
                            
                            return (
                                <li key={i} className="flex flex-col p-2 rounded bg-gray-700/50">
                                    <div className="flex flex-wrap gap-1">
                                        {allPlayersInGame.map((id, idx) => {
                                            const name = getPlayerName(id);
                                            const isTargetPlayer = id === player.id;
                                            return (
                                                <span key={idx} className={isTargetPlayer ? "text-yellow-400 font-bold" : "text-gray-300"} style={isTargetPlayer ? { textShadow: '0 0 8px rgba(250, 204, 21, 0.8)' } : {}}>
                                                    {name}{idx < allPlayersInGame.length - 1 ? ', ' : ''}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </li>
                            )
                        })}
            </ul>
        );
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-white shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-yellow-400 arcade-font">{player.name} 정보 관리</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white">&times;</button>
                </div>
                
                <div className="space-y-4">
                            <button onClick={handleToggleRest} className={`w-full arcade-button font-bold py-2 rounded-lg ${currentPlayer.isResting ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-600 text-white hover:bg-gray-500'}`}>
                                {currentPlayer.isResting ? '휴식 해제 (복귀)' : '휴식 상태로 전환'}
                            </button>

                            <div className="flex items-center justify-between bg-gray-700/50 p-2 rounded-lg">
                                <span className="font-bold text-gray-300">현재 게임 수 조작</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => handleAdjustGameCount(-1)} className="w-8 h-8 bg-gray-600 hover:bg-gray-500 rounded text-xl font-bold flex items-center justify-center">-</button>
                                    <span className="text-xl font-bold text-yellow-400 w-8 text-center">{(currentPlayer.todayRecentGames || []).length}</span>
                                    <button onClick={() => handleAdjustGameCount(1)} className="w-8 h-8 bg-gray-600 hover:bg-gray-500 rounded text-xl font-bold flex items-center justify-center">+</button>
                                </div>
                            </div>
                            
                            <hr className="border-gray-600"/>
                            <h4 className="font-bold text-yellow-400 text-center">오늘의 매칭 히스토리</h4>
                            <RecentGamesList games={currentPlayer.todayRecentGames} />
                        </div>
                
                <div className="mt-6 flex flex-col gap-2">
                    <button onClick={handleDeletePermanently} className="w-full text-xs arcade-button bg-red-900/50 hover:bg-red-800 text-red-300 font-bold py-2 rounded-lg">선수 완전 삭제</button>
                </div>
            </div>
        </div>
    );
}

// [자동매칭] 설정 모달 대규모 업데이트 (수정됨)

function ConfirmationModal({ title, body, onConfirm, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[80] p-4"><div className="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-white mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><div className="flex gap-4"><button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button><button onClick={onConfirm} className="w-full arcade-button bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg transition-colors">확인</button></div></div></div>); }

function CourtSelectionModal({ courts, onSelect, onCancel }) {
    const [isProcessing, setIsProcessing] = useState(false);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font">코트 선택</h3>
                <p className="text-gray-300 mb-6">경기를 시작할 코트를 선택해주세요.</p>
                <div className="flex flex-col gap-3">
                    {courts.map(courtIdx => (
                        <button
                            key={courtIdx}
                            onClick={() => {
                                setIsProcessing(true);
                                onSelect(courtIdx);
                            }}
                            className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                            disabled={isProcessing}
                        >
                            {isProcessing ? '처리 중...' : `${courtIdx + 1}번 코트`}
                        </button>
                    ))}
                </div>
                <button
                    onClick={onCancel}
                    className="mt-6 w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors"
                    disabled={isProcessing}
                >
                    취소
                </button>
            </div>
        </div>
    );
}

// [수정] body에 줄바꿈(\n)이 있으면 그대로 보이도록 whitespace-pre-line 적용
function AlertModal({ title, body, onClose }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[80] p-4"><div className="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">{title}</h3><p className="text-gray-300 mb-6 whitespace-pre-line text-sm leading-relaxed">{body}</p><button onClick={onClose} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">확인</button></div></div> ); }


// ===================================================================================
// [소모임 동기화] 수동 동기화 결과 모달
// ===================================================================================
function SomoimSyncResultModal({ result, onClose }) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[80] p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-white shadow-lg flex flex-col" style={{ maxHeight: '85vh' }}>
                <h3 className="text-xl font-bold text-teal-400 mb-4 arcade-font text-center flex-shrink-0">🔄 동기화 완료</h3>
                <div className="flex-grow overflow-y-auto space-y-3 text-sm">
                    {result.noEvent ? (
                        <p className="text-center text-gray-300 py-4">
                            오늘 날짜의 소모임 정모가 없습니다.<br/>
                            <span className="text-xs text-gray-500">(정모가 등록된 날에만 선수카드가 생성됩니다)</span>
                        </p>
                    ) : (
                        <>
                            {result.events?.length > 0 && (
                                <div className="bg-gray-700/60 rounded-lg p-2.5">
                                    <p className="text-xs text-gray-400 mb-1">오늘 정모</p>
                                    {result.events.map((ev, i) => (
                                        <p key={i} className="font-bold text-yellow-300 text-xs">{ev.name}</p>
                                    ))}
                                </div>
                            )}
                            <div className="bg-gray-700/60 rounded-lg p-2.5 space-y-1.5">
                                <p>✅ 새로 입장: <b className="text-green-400">{result.created.length}명</b>
                                    {result.created.length > 0 && <span className="text-xs text-gray-400 block">{result.created.join(', ')}</span>}
                                </p>
                                <p>♻️ 재입장 처리: <b className="text-teal-300">{result.activated.length}명</b>
                                    {result.activated.length > 0 && <span className="text-xs text-gray-400 block">{result.activated.join(', ')}</span>}
                                </p>
                                <p>👍 이미 입장 중: <b className="text-gray-300">{result.already.length}명</b>
                                    {result.already.length > 0 && <span className="text-xs text-gray-400 block">{result.already.join(', ')}</span>}
                                </p>
                            </div>
                            {result.unmatched.length > 0 && (
                                <div className="bg-yellow-900/30 border border-yellow-500/40 rounded-lg p-2.5">
                                    <p className="text-yellow-300 font-bold text-xs mb-1">⚠ 명단에 없어 카드가 생성되지 않은 참석자 ({result.unmatched.length}명)</p>
                                    <p className="text-xs text-yellow-200">{result.unmatched.join(', ')}</p>
                                    <p className="text-[10px] text-gray-400 mt-1.5">
                                        관리자 설정 → 선수 정보 관리에서 이 선수들을 추가한 뒤 다시 동기화해주세요.
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <button onClick={onClose} className="mt-4 w-full arcade-button bg-teal-500 hover:bg-teal-600 text-black font-bold py-2 rounded-lg flex-shrink-0">확인</button>
            </div>
        </div>
    );
}


// ===================================================================================
// [내 기록] 일반 선수가 자기 카드를 탭하면 보이는 오늘의 기록 모달
// 오늘 몇 경기 했는지 + 매 경기 누구와 같은 편/상대였는지 (관리자 기능 아님, 조회 전용)
// ===================================================================================
function MyHistoryModal({ player, allPlayers, onClose }) {
    const games = (player?.todayRecentGames || []);
    const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[60] p-4" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-2xl p-5 w-full max-w-sm text-white shadow-lg flex flex-col"
                style={{ maxHeight: '80vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-3 flex-shrink-0">
                    <h3 className="text-lg font-bold text-yellow-400 arcade-font">🏸 내 기록</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>

                <div className="bg-gray-700/60 rounded-xl p-3 text-center mb-3 flex-shrink-0">
                    <p className="text-sm text-gray-400">오늘 경기 수</p>
                    <p className="text-3xl font-bold text-yellow-400 arcade-font">{games.length}<span className="text-base ml-1">경기</span></p>
                </div>

                <div className="flex-grow overflow-y-auto space-y-1.5 pr-1">
                    {games.length === 0 && (
                        <p className="text-sm text-gray-500 text-center py-4">아직 오늘 경기 기록이 없어요.<br/>곧 매칭에 뽑힐 거예요!</p>
                    )}
                    {games.map((game, i) => {
                        if (game.isManual) {
                            return (
                                <div key={i} className="bg-gray-700/50 rounded-lg p-2.5 text-sm text-gray-400">
                                    관리자 조정 기록
                                </div>
                            );
                        }
                        return (
                            <div key={i} className="bg-gray-700/50 rounded-lg p-2.5 text-sm">
                                <p>
                                    <span className="text-gray-500 text-xs mr-1.5">함께</span>
                                    <span className="text-green-300 font-semibold">{game.partners.map(getPlayerName).join(', ') || '-'}</span>
                                </p>
                                <p className="mt-0.5">
                                    <span className="text-gray-500 text-xs mr-1.5">상대</span>
                                    <span className="text-gray-200">{game.opponents.map(getPlayerName).join(', ') || '-'}</span>
                                </p>
                            </div>
                        );
                    })}
                </div>

                <button onClick={onClose} className="mt-4 w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg flex-shrink-0">확인</button>
            </div>
        </div>
    );
}

export { SeasonModal, AdminEditPlayerModal, ConfirmationModal, AlertModal, CourtSelectionModal, SomoimSyncResultModal, MyHistoryModal };