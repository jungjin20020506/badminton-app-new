import React, { useState, useEffect } from 'react';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { playersRef } from '../lib/firebase';
import { getLevelColor, getTeamOf, getWinLoss, TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../lib/helpers';

// [청백전] 길게 눌러서 열리는 모달용 — 손가락을 뗄 때 브라우저가 만들어 내는 '클릭'이
// 방금 열린 모달의 배경에 떨어져 곧바로 닫혀 버리는 것을 막는다 (열린 뒤 600ms는 배경 탭 무시)
function useBackdropGuard(onClose) {
    const openedAtRef = React.useRef(Date.now());
    return () => { if (Date.now() - openedAtRef.current > 600) onClose(); };
}

// [청백전] 경기 기록 한 건의 승/패 배지 (승패가 없는 일반 모드 기록은 아무것도 안 보인다)
function ResultBadge({ game }) {
    if (!game || !game.result) return null;
    if (game.result === 'win') return <span className="tm-result-badge win">승</span>;
    if (game.result === 'loss') return <span className="tm-result-badge loss">패</span>;
    return <span className="tm-result-badge none">무</span>;
}

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



function AdminEditPlayerModal({ player, allPlayers, onClose, setModal, teamMode = false }) {
    const currentPlayer = allPlayers[player.id] || player;

    const handleToggleRest = async () => {
        await updateDoc(doc(playersRef, player.id), { isResting: !currentPlayer.isResting });
        onClose();
    };

    // [청백전] 승/패 수동 조작 — 잘못 넣은 결과를 관리자가 바로잡는다 (0 아래로는 안 내려감)
    const { wins, losses } = getWinLoss(currentPlayer);
    const handleAdjustWinLoss = async (field, delta) => {
        const cur = field === 'todayWins' ? wins : losses;
        const next = Math.max(0, cur + delta);
        if (next === cur) return;
        try {
            await updateDoc(doc(playersRef, player.id), { [field]: next });
        } catch (error) {
            console.error("Win/loss adjustment failed:", error);
        }
    };
    // [청백전] 팀 바꾸기 — 입장할 때 팀을 잘못 골랐을 때
    const currentTeam = getTeamOf(currentPlayer);
    const handleSetTeam = async (team) => {
        if (team === currentTeam) return;
        try {
            await updateDoc(doc(playersRef, player.id), { team });
        } catch (error) {
            console.error("Team change failed:", error);
        }
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

                            const allPlayersInGame = [player.id, ...(game.partners || []), ...(game.opponents || [])];
                            
                            return (
                                <li key={i} className="flex flex-col p-2 rounded bg-gray-700/50">
                                    <div className="flex flex-wrap gap-1 items-center">
                                        <ResultBadge game={game} />
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

                            {/* [청백전] 승/패 수동 조작 + 팀 변경 */}
                            {teamMode && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold text-gray-300 text-sm">⚔️ 승패 수동 조작</span>
                                        <span className="text-[10px] text-gray-500">팀 점수판은 바뀌지 않아요</span>
                                    </div>
                                    <div className="tm-wl-adjust">
                                        <div className="cell w">
                                            <span className="k">승</span>
                                            <div className="ctr">
                                                <button type="button" onClick={() => handleAdjustWinLoss('todayWins', -1)} aria-label="승 -1">−</button>
                                                <b>{wins}</b>
                                                <button type="button" onClick={() => handleAdjustWinLoss('todayWins', 1)} aria-label="승 +1">+</button>
                                            </div>
                                        </div>
                                        <div className="cell l">
                                            <span className="k">패</span>
                                            <div className="ctr">
                                                <button type="button" onClick={() => handleAdjustWinLoss('todayLosses', -1)} aria-label="패 -1">−</button>
                                                <b>{losses}</b>
                                                <button type="button" onClick={() => handleAdjustWinLoss('todayLosses', 1)} aria-label="패 +1">+</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between bg-gray-700/50 p-2 rounded-lg">
                                        <span className="font-bold text-gray-300 text-sm">소속 팀</span>
                                        <div className="flex gap-1.5">
                                            {[TEAM_BLUE, TEAM_WHITE].map(team => (
                                                <button
                                                    key={team}
                                                    type="button"
                                                    onClick={() => handleSetTeam(team)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-black arcade-button border ${currentTeam === team
                                                        ? (team === TEAM_BLUE ? 'bg-blue-500 border-blue-400 text-white' : 'bg-gray-100 border-white text-gray-900')
                                                        : 'bg-gray-700 border-gray-600 text-gray-300'}`}
                                                >
                                                    {TEAM_META[team].label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                            
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

// [히든 키] 전체 내보내기 비밀 키 입력 모달 — 키를 아는 사람만 실행할 수 있다.
function HiddenKeyModal({ onSubmit, onCancel }) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        if (busy || !value.trim()) return;
        setBusy(true);
        try { await onSubmit(value); } finally { setBusy(false); }
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[80] p-4">
            <div className="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg">
                <h3 className="text-xl font-bold text-white mb-2">🔒 히든 키</h3>
                <p className="text-gray-400 text-sm mb-4">대기자 전체 내보내기를 실행하려면<br/>관리자 히든 키를 입력하세요.</p>
                <input
                    type="password"
                    inputMode="text"
                    autoFocus
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-center text-white text-lg tracking-widest mb-4 focus:outline-none focus:border-yellow-400"
                    placeholder="••••"
                />
                <div className="flex gap-4">
                    <button onClick={onCancel} disabled={busy} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button>
                    <button onClick={submit} disabled={busy || !value.trim()} className="w-full arcade-button bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg transition-colors disabled:bg-gray-500">
                        {busy ? '확인 중...' : '실행'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ConfirmationModal({ title, body, onConfirm, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[80] p-4"><div className="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-white mb-4">{title}</h3><p className="text-gray-300 mb-6 whitespace-pre-line">{body}</p><div className="flex gap-4"><button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button><button onClick={onConfirm} className="w-full arcade-button bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg transition-colors">확인</button></div></div></div>); }

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
// [자동 매칭 v2] 매칭 선택지 모달
// -----------------------------------------------------------------------------------
// '남자 매칭' 버튼을 누르면 바로 한 경기가 만들어지던 예전 방식 대신,
// 베스트 2 / 보통 2 / 아쉬움 2 = 총 6개 후보를 이유와 함께 보여주고 관리자가 고른다.
//
// 관리자가 헷갈리지 않도록 신경 쓴 부분
//  · 각 후보에 "왜 이 등급인지"를 이름과 숫자가 들어간 문장으로 설명
//  · 경기중인 선수는 무채색 + '경기중' 딱지 + 몇 번 코트를 기다려야 하는지 명시
//  · 지금 상황에서 좋은 조합이 없으면 맨 위에 솔직하게 안내
//  · 고르는 순간 목록에 들어가므로, 실수해도 길게 눌러 삭제 가능 (기존 기능)
// ===================================================================================

/** 선택지 안에 들어가는 작은 선수 칩 */
function OptionPlayerChip({ player }) {
    const levelColor = getLevelColor(player.level, player.isGuest);
    return (
        <div className={`mo-chip ${player.onCourt ? 'playing' : ''} ${player.team === TEAM_BLUE ? 'tm-blue' : player.team === TEAM_WHITE ? 'tm-white' : ''}`}>
            <div className="mo-chip-name">{player.name}</div>
            <div className="mo-chip-sub">
                <span style={{ color: player.onCourt ? '#9aa0aa' : levelColor }}>{player.level.replace('조', '')}</span>
                <span className="mo-chip-games">{player.realGames}G</span>
            </div>
            {player.onCourt && <span className="mo-chip-tag">경기중</span>}
        </div>
    );
}

function MatchOptionsModal({ genderLabel, result, queueCount, onSelect, onRegenerate, onCancel }) {
    const [pageIndex, setPageIndex] = useState(0);
    const [busy, setBusy] = useState(false);

    const pages = result?.pages || [];
    const options = pages[pageIndex] || [];
    const hasMorePages = pages.length > 1;

    const handlePick = async (option) => {
        if (busy) return;
        setBusy(true);
        try { await onSelect(option); } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-end sm:items-center justify-center z-[70] p-0 sm:p-4">
            <div className="mo-sheet modal-content">

                {/* ── 머리말 ── */}
                <div className="mo-head">
                    <div className="min-w-0">
                        <h3 className="mo-title">{genderLabel} 매칭 고르기</h3>
                        <p className="mo-sub">
                            후보 {result.poolSize}명 · 대기 {result.waitingCount}명 · 경기중 {result.onCourtCount}명
                            {queueCount > 0 && <> · 목록에 {queueCount}경기 대기</>}
                        </p>
                    </div>
                    <button onClick={onCancel} className="mo-close" aria-label="닫기">&times;</button>
                </div>

                {/* ── 지금 상황이 안 좋으면 솔직하게 알려준다 ── */}
                {result.qualityHint && (
                    <div className="mo-hint">💡 {result.qualityHint}</div>
                )}

                {/* ── 선택지 목록 ── */}
                <div className="mo-list">
                    {options.map((option, i) => (
                        <button
                            key={`${option.ids.join('-')}-${i}`}
                            type="button"
                            className={`mo-card ${option.tier}`}
                            onClick={() => handlePick(option)}
                            disabled={busy}
                        >
                            <div className="mo-card-head">
                                <span className="mo-tier">{option.tierEmoji} {option.tierLabel}</span>
                                {option.onCourtIds.length > 0 && (
                                    <span className="mo-wait-chip">
                                        ⏳ {option.waitCourts.map(c => `${c + 1}번`).join('·')} 코트 대기
                                    </span>
                                )}
                            </div>

                            <div className="mo-teams">
                                <div className="mo-team">
                                    <OptionPlayerChip player={option.players[0]} />
                                    <OptionPlayerChip player={option.players[1]} />
                                </div>
                                <div className="mo-vs">VS</div>
                                <div className="mo-team">
                                    <OptionPlayerChip player={option.players[2]} />
                                    <OptionPlayerChip player={option.players[3]} />
                                </div>
                            </div>

                            <ul className="mo-reasons">
                                {option.reasons.map((line, k) => (
                                    <li key={k} className={`tone-${line.tone}`}>{line.text}</li>
                                ))}
                            </ul>
                        </button>
                    ))}
                </div>

                {/* ── 아래 버튼 ── */}
                <div className="mo-foot">
                    {hasMorePages && (
                        <button
                            type="button"
                            className="mo-btn ghost"
                            disabled={busy}
                            onClick={() => setPageIndex(i => (i + 1) % pages.length)}
                        >
                            🔀 다른 조합 ({pageIndex + 1}/{pages.length})
                        </button>
                    )}
                    <button type="button" className="mo-btn ghost" disabled={busy} onClick={onRegenerate}>
                        🔄 다시 계산
                    </button>
                    <button type="button" className="mo-btn cancel" disabled={busy} onClick={onCancel}>
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}


// ===================================================================================
// [내 기록] 일반 선수가 자기 카드를 탭하면 보이는 오늘의 기록 모달
// 오늘 몇 경기 했는지 + 매 경기 누구와 같은 편/상대였는지 (관리자 기능 아님, 조회 전용)
// ===================================================================================
function MyHistoryModal({ player, allPlayers, onClose, teamMode = false }) {
    const games = (player?.todayRecentGames || []);
    const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';
    const { wins, losses } = getWinLoss(player);
    const myTeam = getTeamOf(player);

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
                    {teamMode && (
                        <p className="mt-1 text-sm font-black">
                            {myTeam && <span style={{ color: TEAM_META[myTeam].text }}>{TEAM_META[myTeam].label} · </span>}
                            <span className="text-green-300">{wins}승</span>
                            <span className="text-gray-500 mx-1">·</span>
                            <span className="text-red-300">{losses}패</span>
                        </p>
                    )}
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
                                    <ResultBadge game={game} />
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

// ===================================================================================
// [청백전] 경기 종료 — 이긴 팀 고르기
// -----------------------------------------------------------------------------------
//  코트의 왼쪽 2명(A)과 오른쪽 2명(B)이 각각 어느 팀인지 보여주고, 이긴 팀을 고른다.
//  · 청2 vs 백2 인 정상 경기: '청팀 승리' / '백팀 승리' 큰 버튼 → 그 팀 점수 +1
//  · 팀이 섞인 경기(관리자가 손으로 짠 경우): 'A쪽 승리' / 'B쪽 승리' 로 선수 승패만 기록,
//    팀 점수는 오르지 않는다고 미리 알려준다.
//  · 아래 작은 글씨 '경기 취소' → 기록 없이 코트만 비운다 (잘못 넣은 경기용)
// ===================================================================================
function TeamMatchEndModal({ courtIndex, court, allPlayers, onPickWinner, onCancelMatch, onClose }) {
    const [busy, setBusy] = useState(false);
    const ids = court?.players || [];
    const sideA = [ids[0], ids[1]].filter(Boolean);
    const sideB = [ids[2], ids[3]].filter(Boolean);
    const teamOfSide = (side) => {
        const teams = [...new Set(side.map(id => getTeamOf(allPlayers[id])))];
        return teams.length === 1 && teams[0] ? teams[0] : null; // 한 팀으로 통일돼 있을 때만
    };
    const teamA = teamOfSide(sideA);
    const teamB = teamOfSide(sideB);
    const isProper = teamA && teamB && teamA !== teamB; // 청 vs 백 정상 경기
    const nameOf = (id) => allPlayers[id]?.name || '나간 선수';
    const levelOf = (id) => (allPlayers[id]?.level || '').replace('조', '');

    const pick = async (side) => {
        if (busy) return;
        setBusy(true);
        try { await onPickWinner(side); } finally { setBusy(false); }
    };

    const SideBox = ({ label, side, team }) => (
        <div className={`tm-end-side ${team ? TEAM_META[team].key : 'mixed'}`}>
            <div className="t">{team ? TEAM_META[team].label : `${label}쪽 (팀 섞임)`}</div>
            {side.length === 0 && <div className="p" style={{ color: '#8C93A1' }}>빈 자리</div>}
            {side.map(id => (
                <div key={id} className="p">
                    {!team && <span style={{ color: getTeamOf(allPlayers[id]) ? TEAM_META[getTeamOf(allPlayers[id])].text : '#8C93A1' }}>{getTeamOf(allPlayers[id]) || '?'} </span>}
                    {nameOf(id)}<small>{levelOf(id)}</small>
                </div>
            ))}
        </div>
    );

    const winBtn = (side, team, label) => (
        <button
            type="button"
            disabled={busy}
            onClick={() => pick(side)}
            className={`tm-win-btn ${team ? TEAM_META[team].key : 'side'}`}
        >
            <span className="big">{team ? `${TEAM_META[team].label} 승리` : `${label}쪽 승리`}</span>
            <span className="sm">{team ? `${TEAM_META[team].short}팀 점수 +1` : '선수 승패만 기록'}</span>
        </button>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[80] p-4" onClick={busy ? undefined : onClose}>
            <div className="modal-content bg-gray-800 rounded-2xl p-5 w-full max-w-sm text-white shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-lg font-bold text-yellow-400 arcade-font">🏁 {courtIndex + 1}번 코트 경기 종료</h3>
                    <button onClick={onClose} disabled={busy} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>
                <p className="text-xs text-gray-400 text-center mb-3">이긴 팀을 골라주세요. 선수 승패와 팀 점수가 함께 기록됩니다.</p>

                <div className="tm-end-sides mb-4">
                    <SideBox label="A" side={sideA} team={teamA} />
                    <div className="tm-end-vs">VS</div>
                    <SideBox label="B" side={sideB} team={teamB} />
                </div>

                {!isProper && (
                    <div className="bg-yellow-900/30 border border-yellow-500/40 rounded-lg p-2 text-[11px] text-yellow-200 text-center mb-3 leading-relaxed">
                        청 vs 백 경기가 아니라서 <b>팀 점수는 오르지 않아요.</b><br/>이긴 쪽 선수에게 승, 진 쪽에 패만 기록됩니다.
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                    {isProper ? (
                        <>
                            {teamA === TEAM_BLUE ? winBtn('A', TEAM_BLUE, 'A') : winBtn('B', TEAM_BLUE, 'B')}
                            {teamA === TEAM_WHITE ? winBtn('A', TEAM_WHITE, 'A') : winBtn('B', TEAM_WHITE, 'B')}
                        </>
                    ) : (
                        <>
                            {winBtn('A', null, 'A')}
                            {winBtn('B', null, 'B')}
                        </>
                    )}
                </div>

                <button type="button" className="tm-cancel-link" disabled={busy} onClick={onCancelMatch}>
                    경기 취소 (기록 없이 코트만 비우기)
                </button>
            </div>
        </div>
    );
}

// ===================================================================================
// [청백전] 점수판 수정 — 점수판을 길게 눌렀을 때
// ===================================================================================
function TeamScoreEditModal({ teamScores, onSave, onClose }) {
    const guardedClose = useBackdropGuard(onClose);
    const [blue, setBlue] = useState(Math.max(0, Number(teamScores?.blue) || 0));
    const [white, setWhite] = useState(Math.max(0, Number(teamScores?.white) || 0));
    const [busy, setBusy] = useState(false);
    // 다른 관리자가 그 사이 점수를 올렸으면 화면의 초기값도 따라간다 (아직 손대기 전일 때만)
    const [touched, setTouched] = useState(false);
    useEffect(() => {
        if (touched) return;
        setBlue(Math.max(0, Number(teamScores?.blue) || 0));
        setWhite(Math.max(0, Number(teamScores?.white) || 0));
    }, [teamScores, touched]);

    const clamp = (v) => Math.max(0, Math.min(999, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0));
    // 입력창이 매 렌더마다 다시 만들어져 포커스를 잃지 않도록, 컴포넌트가 아니라 함수로 그린다
    const renderCell = (team, value, setValue) => (
        <div className={`tm-edit-cell ${TEAM_META[team].key}`}>
            <div className="t">{TEAM_META[team].label}</div>
            <div className="ctr">
                <button type="button" onClick={() => { setTouched(true); setValue(v => clamp(v - 1)); }} aria-label={`${TEAM_META[team].label} -1`}>−</button>
                <input
                    type="number" inputMode="numeric" min="0" max="999" value={value}
                    aria-label={`${TEAM_META[team].label} 점수`}
                    onChange={(e) => { setTouched(true); setValue(clamp(e.target.value)); }}
                    onFocus={(e) => e.target.select()}
                />
                <button type="button" onClick={() => { setTouched(true); setValue(v => clamp(v + 1)); }} aria-label={`${TEAM_META[team].label} +1`}>+</button>
            </div>
        </div>
    );

    const save = async () => {
        if (busy) return;
        setBusy(true);
        try { await onSave({ blue: clamp(blue), white: clamp(white) }); } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[80] p-4" onClick={busy ? undefined : guardedClose}>
            <div className="modal-content bg-gray-800 rounded-2xl p-5 w-full max-w-sm text-white shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-lg font-bold text-yellow-400 arcade-font">⚔️ 점수판 수정</h3>
                    <button onClick={onClose} disabled={busy} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>
                <p className="text-xs text-gray-400 text-center mb-3">잘못 올라간 점수를 바로잡습니다. 선수 개인 승패는 바뀌지 않아요.</p>
                <div className="tm-edit-row">
                    {renderCell(TEAM_BLUE, blue, setBlue)}
                    {renderCell(TEAM_WHITE, white, setWhite)}
                </div>
                <div className="flex gap-2 mt-4">
                    <button type="button" onClick={() => { setTouched(true); setBlue(0); setWhite(0); }} disabled={busy} className="flex-shrink-0 arcade-button bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-3 rounded-lg text-xs">0 : 0</button>
                    <button type="button" onClick={onClose} disabled={busy} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg">취소</button>
                    <button type="button" onClick={save} disabled={busy} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">{busy ? '저장 중...' : '저장'}</button>
                </div>
            </div>
        </div>
    );
}

export { SeasonModal, AdminEditPlayerModal, ConfirmationModal, AlertModal, CourtSelectionModal, SomoimSyncResultModal, MyHistoryModal, HiddenKeyModal, MatchOptionsModal, TeamMatchEndModal, TeamScoreEditModal };