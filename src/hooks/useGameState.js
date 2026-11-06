import { useCallback, useMemo } from 'react';
import { gameStateRef, runTx, normalizeGameState } from '../lib/firebase';
import { calculateLocations, LEVEL_ORDER } from '../lib/helpers';
import { log } from '../lib/logger';
import { toastError } from '../lib/toast';

// ===================================================================================
// [게임 상태] gameState 트랜잭션 갱신기 + 파생 값(위치·대기 명단·경기중 선수)
// -----------------------------------------------------------------------------------
// updateGameState(updateFunction, 실패 문구):
//   읽고 → 순수 함수로 새 상태 만들고 → set (전체 덮어쓰기). 일시 오류는 runTx 가 재시도.
//   실패하면 토스트로 알리고 throw 한다 — 호출처는 후속 동작(모달 닫기 등)을 건너뛸 수 있다.
// ===================================================================================
export function useGameState({ gameState, activePlayers }) {
    const updateGameState = useCallback(async (updateFunction, customErrorMessage) => {
        try {
            await runTx('gameState', async (transaction) => {
                const snap = await transaction.get(gameStateRef);
                // 문서가 없거나 코트 수 등이 빠져 있어도 갱신 함수가 NaN 인덱스를 만들지 않도록 기본값을 채운다
                const currentState = normalizeGameState(snap.exists() ? snap.data() : null);
                const { newState } = updateFunction(currentState);
                transaction.set(gameStateRef, newState);
            });
        } catch (err) {
            log.error('[gameState] 저장 실패:', err);
            // 동시성 문제로 인한 오류는 사용자에게 알리지 않음
            if (err?.message?.includes('다른 관리자에 의해 슬롯이 이미 채워졌습니다.')) {
                log.info('Slot already filled, operation cancelled silently.');
            } else {
                // 모달 대신 토스트 — 경기 중 흐름을 끊지 않으면서 "다시 누르면 된다"는 걸 알린다
                toastError(`${customErrorMessage || '저장되지 않았어요.'} 다시 눌러주세요.`);
            }
            throw err;
        }
    }, []);

    const playerLocations = useMemo(() => (gameState ? calculateLocations(gameState, activePlayers) : {}), [gameState, activePlayers]);
    const findPlayerLocation = useCallback((playerId) => playerLocations[playerId] || { location: 'waiting' }, [playerLocations]);

    // 대기 선수 — 휴식 중인 선수도 화면에 표시(맨 뒤), 급수 → 입장 시각 순
    const waitingPlayers = useMemo(() => Object.values(activePlayers)
        .filter((p) => playerLocations[p.id]?.location === 'waiting')
        .sort((a, b) => {
            if (a.isResting !== b.isResting) return a.isResting ? 1 : -1;
            const levelA = LEVEL_ORDER[a.level] ?? 99; // [청백전] S조=0 이라 ?? 사용
            const levelB = LEVEL_ORDER[b.level] ?? 99;
            if (levelA !== levelB) return levelA - levelB;
            return new Date(a.entryTime) - new Date(b.entryTime);
        }), [activePlayers, playerLocations]);
    const maleWaitingPlayers = useMemo(() => waitingPlayers.filter((p) => p.gender === '남'), [waitingPlayers]);
    const femaleWaitingPlayers = useMemo(() => waitingPlayers.filter((p) => p.gender === '여'), [waitingPlayers]);

    const inProgressPlayerIds = useMemo(() => {
        if (!gameState?.inProgressCourts) return new Set();
        return new Set(gameState.inProgressCourts.filter((c) => c && c.players).flatMap((c) => c.players).filter(Boolean));
    }, [gameState]);

    // 경기중인 선수가 '몇 번 코트'에 있는지 — 예약 경기에 "3번 코트 끝나면 시작"을 표시하는 데 쓴다
    const courtIndexByPlayer = useMemo(() => {
        const map = {};
        (gameState?.inProgressCourts || []).forEach((court, courtIndex) => {
            if (court?.players) court.players.forEach((id) => { if (id) map[id] = courtIndex; });
        });
        return map;
    }, [gameState]);

    return {
        updateGameState, playerLocations, findPlayerLocation,
        waitingPlayers, maleWaitingPlayers, femaleWaitingPlayers,
        inProgressPlayerIds, courtIndexByPlayer,
    };
}
