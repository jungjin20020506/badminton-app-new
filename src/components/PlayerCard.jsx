import React, { useState, useEffect, useCallback, useRef } from 'react';
import { isAdminName, getLevelColor } from '../lib/helpers';

// ===================================================================================
// 자식 컴포넌트들
// ===================================================================================
const PlayerCard = React.memo(({ player, context, isAdmin, onCardClick, onAction, onLongPress, isCurrentUser, isMovable = true, isSelectedForWin = false, isPlaying = false }) => {
    const pressTimerRef = useRef(null);
    const cardRef = useRef(null);

    const stableOnLongPress = useCallback(() => {
        if(onLongPress) onLongPress(player);
    }, [onLongPress, player]);

    const handlePressStart = useCallback((e) => {
        if (!isMovable || !isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(stableOnLongPress, 1000);
    }, [isAdmin, isMovable, stableOnLongPress]);

    const handlePressEnd = useCallback(() => {
        if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        const cardElement = cardRef.current;
        if (cardElement && isAdmin && isMovable) {
            const options = { passive: true };
            cardElement.addEventListener('touchstart', handlePressStart, options);
            cardElement.addEventListener('touchend', handlePressEnd);
            cardElement.addEventListener('touchcancel', handlePressEnd);

            return () => {
                cardElement.removeEventListener('touchstart', handlePressStart);
                cardElement.removeEventListener('touchend', handlePressEnd);
                cardElement.removeEventListener('touchcancel', handlePressEnd);
            };
        }
    }, [isAdmin, isMovable, handlePressStart, handlePressEnd]);

    const handleContextMenu = (e) => { e.preventDefault(); };

    const genderStyle = {
        boxShadow: `inset 4px 0 0 0 ${player.gender === '남' ? '#3B82F6' : '#EC4899'}`
    };

    const adminIcon = (player.role === 'admin' || isAdminName(player.name)) ? '👑' : '';
    const isWaiting = !context.location;
    const playerNameClass = `player-name text-white text-xs font-bold whitespace-nowrap leading-tight tracking-tighter`;
    const playerInfoClass = `player-info text-gray-400 text-[10px] leading-tight mt-px whitespace-nowrap`;

    const levelColor = getLevelColor(player.level, player.isGuest);

    const levelStyle = {
        color: levelColor,
        fontWeight: 'bold',
        fontSize: '14px',
        textShadow: `0 0 5px ${levelColor}`
    };

    const cardStyle = {
        ...genderStyle,
        borderWidth: '1px',
               borderStyle: 'solid',
        borderColor: 'transparent',
        transition: 'all 0.2s ease-in-out',
        opacity: isPlaying ? 0.6 : 1,
    };

    if (context.selected || isSelectedForWin) {
        cardStyle.borderColor = '#CDFB47';
        cardStyle.transform = 'scale(1.08)';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 16px 3px rgba(205, 251, 71, 0.6)`;
    }

    if (isCurrentUser) {
        cardStyle.borderColor = '#FF6A52';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 13px 3px rgba(255, 106, 82, 0.55)`;
    }

    const isLongPressDisabled = context.location === 'court';
    // [수정] actionLabel이 'auto' 위치도 인식하도록 수정
    const actionLabel = (isWaiting || context.location === 'auto') ? '선수 내보내기' : '대기자로 이동';

    return (
        <div
            ref={cardRef}
            id={isCurrentUser ? 'my-player-card' : undefined}
            // [수정] 휴식 중일 때 filter grayscale 클래스 적용 (기존 코드 복원)
            className={`player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 w-full ${player.isResting ? 'filter grayscale' : ''}`}
            style={cardStyle}
            onClick={isMovable && onCardClick ? () => onCardClick() : null}
            onMouseDown={isAdmin && isMovable && !isLongPressDisabled ? handlePressStart : null}
            onMouseUp={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onMouseLeave={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onContextMenu={handleContextMenu}
        >
            <div>
                <div className={playerNameClass}>{adminIcon}{player.name}</div>
                <div className={playerInfoClass}>
                    <span style={levelStyle}>{player.level.replace('조','')}</span>
                    <span className="ml-1 text-gray-300 font-bold">{player.todayRecentGames ? player.todayRecentGames.length : 0}G</span>
                </div>
            </div>
            {isAdmin && onAction && (
                <button
                    onClick={(e) => { e.stopPropagation(); onAction(player); }}
                    className={`absolute -top-2 -right-2 p-1 text-gray-500 hover:text-yellow-400`}
                    aria-label={actionLabel}
                ><i className={"fas fa-times-circle fa-xs"}></i></button>
            )}
        </div>
    );
});
const EmptySlot = ({ onSlotClick }) => (
    <div
        className="player-slot h-14 bg-black/30 rounded-md flex items-center justify-center text-gray-600 border-2 border-dashed border-gray-700 cursor-pointer hover:bg-gray-700/50 hover:border-yellow-400 transition-all"
        onClick={onSlotClick}
    >
        <span className="text-xl font-bold">+</span>
    </div>
);

// [나간 선수] 경기 진행 중 프로그램에서 나간(퇴장/휴식 처리된) 선수를 표시하는 카드.
// 카드가 사라지지 않고 '나간 선수'로 표시되므로 관리자가 정상적으로 경기를 종료할 수 있다.
const LeftPlayerCard = ({ name }) => (
    <div className="player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 w-full border border-dashed border-red-500/60 bg-red-900/20 opacity-80 filter grayscale">
        <div className="player-name text-red-300 text-[11px] font-bold whitespace-nowrap leading-tight truncate px-0.5">{name}</div>
        <div className="text-red-400/90 text-[9px] leading-tight mt-px">🚪 나간 선수</div>
    </div>
);
const CourtTimer = ({ court }) => {
    const [time, setTime] = useState('00:00');
    useEffect(() => {
        if (court && court.startTime) {
            const timerId = setInterval(() => {
                const now = new Date().getTime();
                const startTime = new Date(court.startTime).getTime();
                const diff = Math.floor((now - startTime) / 1000);
                const minutes = String(Math.floor(diff / 60)).padStart(2, '0');
                const seconds = String(diff % 60).padStart(2, '0');
                setTime(`${minutes}:${seconds}`);
            }, 1000);
            return () => clearInterval(timerId);
        } else { setTime('00:00'); }
    }, [court]);
    return <div className="text-center text-xs font-mono text-white mt-1 tracking-wider">{time}</div>;
};


export { PlayerCard, EmptySlot, LeftPlayerCard, CourtTimer };