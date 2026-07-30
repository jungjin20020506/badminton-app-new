import React, { useEffect, useCallback, useRef } from 'react';
import { PLAYERS_PER_MATCH } from '../lib/helpers';
import { PlayerCard, EmptySlot, LeftPlayerCard, CourtTimer } from './PlayerCard';

const WaitingListSection = React.memo(({ maleWaitingPlayers, femaleWaitingPlayers, selectedPlayerIds, isAdmin, handleCardClick, handleDeleteFromWaiting, setModal, currentUser, inProgressPlayerIds, onClearAllWaitingPlayers }) => {
    const renderPlayerGrid = (players) => (
        <div className="grid grid-cols-5 gap-1">
            {players.map(player => (
                <PlayerCard
                    key={player.id}
                    player={player}
                    context={{ location: null, selected: selectedPlayerIds.includes(player.id) }}
                    isAdmin={isAdmin}
                    onCardClick={() => handleCardClick(player.id)}
                    onAction={handleDeleteFromWaiting}
                    onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})}
                    isCurrentUser={currentUser && player.id === currentUser.id}
                    isPlaying={inProgressPlayerIds.has(player.id)}
                />
            ))}
        </div>
    );

    const totalWaiting = maleWaitingPlayers.length + femaleWaitingPlayers.length;

    return (
        <section className="bg-gray-800/50 rounded-lg p-2.5" data-tut="waiting">
            <div className="cox-secline mb-2.5">
                <div className="lbl">
                    <span className="tick"></span>
                    <span>대기 명단</span>
                    <span className="count">{totalWaiting}</span>
                </div>
                {/* [신규 기능] 대기자 전체 내보내기 버튼 */}
                {isAdmin && totalWaiting > 0 && (
                    <button onClick={onClearAllWaitingPlayers} className="cox-pill-danger" data-tut="waiting-clear">
                        전체 내보내기
                    </button>
                )}
            </div>
            <div className="flex flex-col gap-2">
                {renderPlayerGrid(maleWaitingPlayers)}
                {maleWaitingPlayers.length > 0 && femaleWaitingPlayers.length > 0 && (
                    <hr className="border-dashed border-gray-600 my-1" />
                )}
                {renderPlayerGrid(femaleWaitingPlayers)}
            </div>
        </section>
    );
});


const ScheduledMatchesSection = React.memo(({ numScheduledMatches, scheduledMatches, players, selectedPlayerIds, isAdmin, handleCardClick, handleReturnToWaiting, setModal, handleSlotClick, handleStartMatch, currentUser, handleClearScheduledMatches, handleDeleteScheduledMatch, inProgressPlayerIds }) => {
    const pressTimerRef = useRef(null);

    const handlePressStart = (matchIndex) => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            handleDeleteScheduledMatch(matchIndex);
        }, 800);
    };

    const handlePressEnd = () => {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };

    const hasMatches = Object.values(scheduledMatches).some(m => m && m.some(p => p !== null));

    return (
        <section data-tut="scheduled">
            <div className="cox-secline mb-2.5 px-1">
                <div className="lbl cyan">
                    <span className="tick"></span>
                    <span>경기 예정</span>
                </div>
                {isAdmin && hasMatches && (
                    <button onClick={handleClearScheduledMatches} className="cox-pill-danger">전체삭제</button>
                )}
            </div>
            <div id="scheduled-matches" className="flex flex-col gap-2">
                {Array.from({ length: numScheduledMatches }).map((_, matchIndex) => {
                    const match = scheduledMatches[String(matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                    const playerCount = match.filter(p => p).length;
                    return (
                        // [UI 수정] 내부 요소 정렬 및 간격 유지
                        <div key={`schedule-${matchIndex}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
                            <div
                                className="flex-shrink-0 w-8 text-center cursor-pointer flex items-center justify-center" // [UI 수정] 너비 살짝 늘리고 중앙 정렬
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-lg text-white arcade-font">{matchIndex + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {Array(PLAYERS_PER_MATCH).fill(null).map((_, slotIndex) => {
                                    const playerId = match[slotIndex];
                                    const player = players[playerId];
                                    const context = {location: 'schedule', matchIndex, slotIndex, selected: selectedPlayerIds.includes(playerId)};
                                    return player ? ( <PlayerCard key={playerId} player={player} context={context} isAdmin={isAdmin} onCardClick={() => handleCardClick(playerId)} onAction={handleReturnToWaiting} onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} /> ) : ( <EmptySlot key={`schedule-empty-${matchIndex}-${slotIndex}`} onSlotClick={() => handleSlotClick({ location: 'schedule', matchIndex, slotIndex })} /> )
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === PLAYERS_PER_MATCH && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== PLAYERS_PER_MATCH || !isAdmin} onClick={() => handleStartMatch(matchIndex, 'schedule')}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

// [자동매칭] 자동 매칭 섹션 컴포넌트 (UI 변경)
// [수정] 자동 ON/OFF(일정 주기 생성) → '남자/여자 매칭 만들기' 버튼으로 1경기씩 생성
const AutoMatchesSection = React.memo(({ autoMatches, players, isAdmin, handleStartAutoMatch, handleReturnToWaiting, handleClearAutoMatches, handleDeleteAutoMatch, currentUser, handleAutoMatchCardClick, selectedAutoMatchSlot, inProgressPlayerIds, handleAutoMatchSlotClick, handleGenerateMatch, generatingGender }) => {
    const pressTimerRef = useRef(null);

    const handlePressStart = (matchIndex) => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            handleDeleteAutoMatch(matchIndex);
        }, 800);
    };

    const handlePressEnd = () => {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };

    const matchList = Object.entries(autoMatches);

    // [매칭 연출] 새로 만들어진 매칭에만 카드가 슬롯머신처럼 착착 꽂히는 애니메이션을 준다.
    // 선수 구성(시그니처) 기준이라 START로 경기 번호가 당겨지거나 화면이 갱신돼도
    // 이미 본 매칭은 다시 재생되지 않는다. (모든 접속자 화면에서 동일하게 재생)
    const dealSeenRef = useRef(new Set());
    const isFirstDealRef = useRef(true);
    const matchSig = (match) => (match || []).filter(Boolean).join('|');
    if (isFirstDealRef.current) {
        // 접속 직후 첫 렌더에서는 기존 매칭들이 우르르 재생되지 않도록 본 것으로 처리
        matchList.forEach(([, m]) => { const s = matchSig(m); if (s) dealSeenRef.current.add(s); });
        isFirstDealRef.current = false;
    }
    useEffect(() => {
        matchList.forEach(([, m]) => { const s = matchSig(m); if (s) dealSeenRef.current.add(s); });
    });

    return (
        <section data-tut="auto">
            <div className="cox-secline mb-2.5 px-1">
                 <div className="auto-head-left">
                     <div className="lbl green">
                        <span className="tick"></span>
                        <span>🤖 자동 매칭</span>
                     </div>
                 </div>
                 {isAdmin && matchList.length > 0 && (
                    <button onClick={handleClearAutoMatches} className="cox-pill-danger">전체삭제</button>
                 )}
            </div>
            {/* [신규] 누를 때마다 1경기씩 생성하는 '매칭 만들기' 버튼 (관리자 전용) */}
            {isAdmin && (
                <div className="auto-make-row mb-2.5" data-tut="auto-make">
                    <button
                        type="button"
                        className="auto-make-btn male"
                        onClick={() => handleGenerateMatch('남')}
                        disabled={!!generatingGender}
                    >
                        {generatingGender === '남' ? '생성 중...' : '👨 남자 매칭'}
                    </button>
                    <button
                        type="button"
                        className="auto-make-btn female"
                        onClick={() => handleGenerateMatch('여')}
                        disabled={!!generatingGender}
                    >
                        {generatingGender === '여' ? '생성 중...' : '👩 여자 매칭'}
                    </button>
                    {/* [혼복 매칭] 남2+여2 → 남1+여1 팀 자동 배치 */}
                    <button
                        type="button"
                        className="auto-make-btn mixed"
                        onClick={() => handleGenerateMatch('혼복')}
                        disabled={!!generatingGender}
                    >
                        {generatingGender === '혼복' ? '생성 중...' : '💑 혼복 매칭'}
                    </button>
                </div>
            )}
            {matchList.length === 0 && (
                <div className="text-center text-gray-500 p-4 bg-gray-800/60 rounded-lg">
                    <p>만들어진 자동 매칭이 없습니다.</p>
                    <p className="text-xs mt-1">
                        {isAdmin
                            ? <>위의 '매칭 만들기'를 누를 때마다<br/>한 경기씩 만들어집니다.</>
                            : <>관리자가 매칭을 만들면 여기에 표시됩니다.</>}
                    </p>
                </div>
            )}
            <div id="auto-matches" className="flex flex-col gap-2">
                {matchList.map(([matchIndex, match]) => {
                    const playerCount = match.filter(p => p).length;
                    // [매칭 연출] 처음 등장하는 구성이면 카드 딜 애니메이션 클래스 부여
                    const isNewDeal = !!matchSig(match) && !dealSeenRef.current.has(matchSig(match));
                    return (
                        // [UI 수정] 내부 요소 정렬 및 간격 유지
                        <div key={`auto-match-${matchIndex}`} className={`flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1 ${isNewDeal ? 'auto-deal' : ''}`}>
                            <div
                                className="flex-shrink-0 w-8 text-center cursor-pointer flex items-center justify-center" // [UI 수정] 너비 살짝 늘리고 중앙 정렬
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-lg text-white arcade-font">{parseInt(matchIndex, 10) + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {match.map((playerId, slotIndex) => {
                                    const player = players[playerId];
                                    const cardKey = playerId ? `${playerId}-${matchIndex}-${slotIndex}` : `auto-empty-${matchIndex}-${slotIndex}`;
                                    const isSelected = selectedAutoMatchSlot && selectedAutoMatchSlot.matchIndex === matchIndex && selectedAutoMatchSlot.slotIndex === slotIndex;
                                    return player ?
                                        (<PlayerCard key={cardKey} player={player} context={{location: 'auto', selected: isSelected}} isAdmin={isAdmin} onCardClick={() => handleAutoMatchCardClick(matchIndex, slotIndex)} onAction={handleReturnToWaiting} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} />) :
                                        (<EmptySlot key={cardKey} onSlotClick={() => handleAutoMatchSlotClick(matchIndex, slotIndex)} />)
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === 4 && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== 4 || !isAdmin} onClick={() => handleStartAutoMatch(matchIndex, 'auto')}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

const InProgressCourt = React.memo(({ courtIndex, court, players, allPlayers, isAdmin, handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt }) => {
    const pressTimerRef = useRef(null);
    const courtRef = useRef(null);

    const handlePressStart = useCallback(() => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            setCourtMove({ sourceIndex: courtIndex });
            pressTimerRef.current = null;
        }, 800);
    }, [isAdmin, courtIndex, setCourtMove]);

    const handlePressEnd = useCallback(() => {
        if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
    }, []);

    const handleClick = useCallback(() => {
        if (!isAdmin || courtMove.sourceIndex === null) return;

        if (courtMove.sourceIndex === courtIndex) {
            setCourtMove({ sourceIndex: null });
        } else {
            handleMoveOrSwapCourt(courtMove.sourceIndex, courtIndex);
        }
    }, [isAdmin, courtIndex, courtMove, handleMoveOrSwapCourt, setCourtMove]);

    useEffect(() => {
        const element = courtRef.current;
        if (element && isAdmin) {
            const options = { passive: true };
            element.addEventListener('mousedown', handlePressStart);
            element.addEventListener('mouseup', handlePressEnd);
            element.addEventListener('mouseleave', handlePressEnd);
            element.addEventListener('touchstart', handlePressStart, options);
            element.addEventListener('touchend', handlePressEnd);
            element.addEventListener('touchcancel', handlePressEnd);

            return () => {
                element.removeEventListener('mousedown', handlePressStart);
                element.removeEventListener('mouseup', handlePressEnd);
                element.removeEventListener('mouseleave', handlePressEnd);
                element.removeEventListener('touchstart', handlePressStart, options);
                element.removeEventListener('touchend', handlePressEnd);
                element.removeEventListener('touchcancel', handlePressEnd);
            };
        }
    }, [isAdmin, handlePressStart, handlePressEnd]);

    const isSource = courtMove.sourceIndex === courtIndex;
    const courtContainerClass = `flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1 transition-all duration-300 ${isSource ? 'border-2 border-yellow-400 scale-105 shadow-lg shadow-yellow-400/30' : 'border-2 border-transparent'} ${isAdmin ? 'cursor-pointer' : ''}`;

    return (
        <div ref={courtRef} className={courtContainerClass} onClick={handleClick}>
            {/* [UI 수정] 내부 요소 정렬 및 간격 유지 */}
            <div className="flex-shrink-0 w-8 flex flex-col items-center justify-center">
                <p className="font-bold text-lg text-white arcade-font">{courtIndex + 1}</p>
                <p className="font-semibold text-[8px] text-gray-400 arcade-font">코트</p>
            </div>
            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                {(court?.players || Array(PLAYERS_PER_MATCH).fill(null)).map((playerId, slotIndex) => {
                    if (!playerId) return <EmptySlot key={`court-empty-${courtIndex}-${slotIndex}`} />;
                    const player = players[playerId];
                    // [나간 선수] 경기 중 선수가 프로그램에서 나가면(비활성/휴식 처리)
                    // 카드를 '나간 선수'로 표시하여 관리자가 경기를 종료할 수 있게 한다.
                    const isLeft = !player || player.isResting;
                    if (isLeft) {
                        const displayName = player?.name || allPlayers?.[playerId]?.name || '나간 선수';
                        return <LeftPlayerCard key={`court-left-${courtIndex}-${slotIndex}`} name={displayName} />;
                    }
                    return <PlayerCard key={playerId} player={player} context={{ location: 'court', matchIndex: courtIndex }} isAdmin={isAdmin} isCurrentUser={currentUser && player.id === currentUser.id} isMovable={false} />;
                })}
            </div>
            <div className="flex-shrink-0 w-14 text-center">
                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${court && isAdmin ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={!court || !isAdmin} onClick={(e) => { e.stopPropagation(); handleEndMatch(courtIndex); }}>FINISH</button>
                <CourtTimer court={court} />
            </div>
        </div>
    );
});


const InProgressCourtsSection = React.memo(({ numInProgressCourts, inProgressCourts, players, allPlayers, isAdmin, handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt }) => {
    return (
        <section data-tut="courts">
            <div className="cox-secline mb-2.5 px-1">
                <div className="lbl coral">
                    <span className="tick"></span>
                    <span>경기 진행</span>
                </div>
            </div>
            <div id="in-progress-courts" className="flex flex-col gap-2">
                {Array.from({ length: numInProgressCourts }).map((_, courtIndex) => (
                    <InProgressCourt
                        key={`court-${courtIndex}`}
                        courtIndex={courtIndex}
                        court={inProgressCourts[courtIndex]}
                        players={players}
                        allPlayers={allPlayers}
                        isAdmin={isAdmin}
                        handleEndMatch={handleEndMatch}
                        currentUser={currentUser}
                        courtMove={courtMove}
                        setCourtMove={setCourtMove}
                        handleMoveOrSwapCourt={handleMoveOrSwapCourt}
                    />
                ))}
            </div>
        </section>
    );
});


export { WaitingListSection, ScheduledMatchesSection, AutoMatchesSection, InProgressCourtsSection };