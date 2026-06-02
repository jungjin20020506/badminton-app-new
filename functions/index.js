const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https"); // [수정] HttpsError 모듈 가져오기 추가
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging"); // [추가됨] 푸시 알림 발송을 위한 도구

initializeApp();

const RP_CONFIG = { WIN: 30, LOSS: 10, ATTENDANCE: 20, WIN_STREAK_BONUS: 20 };
const ADMIN_ID = "정형진"; 

// ============================================================================
// 1. 일일 정산 로직 (기존 코드 유지)
// ============================================================================
async function runDailyBatchUpdate() {
  logger.log("매일 선수 데이터 정산 작업을 시작합니다.");

  const db = getFirestore();
  const playersRef = db.collection("players");
  
  const allPlayersSnapshot = await playersRef.get();
  if (allPlayersSnapshot.empty) {
    logger.log("등록된 선수가 없어 함수를 종료합니다.");
    return "등록된 선수가 없습니다.";
  }

  const playersToUpdate = [];
  allPlayersSnapshot.forEach(doc => {
    const player = doc.data();
    const todayWins = player.todayWins || 0;
    const todayLosses = player.todayLosses || 0;
    if (todayWins > 0 || todayLosses > 0) {
      playersToUpdate.push({ ref: doc.ref, data: player });
    }
  });

  if (playersToUpdate.length === 0) {
    logger.log("오늘 경기 기록이 있는 선수가 없어 정산을 종료합니다.");
    return "정산할 선수가 없습니다.";
  }

  const batch = db.batch();
  
  playersToUpdate.forEach(playerDoc => {
    const player = playerDoc.data;
    const playerRef = playerDoc.ref;

    const todayWins = player.todayWins || 0;
    const todayLosses = player.todayLosses || 0;
    const todayWinStreakCount = player.todayWinStreakCount || 0;
    
    const updatedData = {
      todayWins: 0,
      todayLosses: 0,
      todayWinStreakCount: 0,
      todayRecentGames: [],
    };

    if (!player.isGuest) {
        if (todayWins > 0 || todayLosses > 0) {
            updatedData.wins = FieldValue.increment(todayWins);
            updatedData.losses = FieldValue.increment(todayLosses);
            updatedData.winStreakCount = FieldValue.increment(todayWinStreakCount);
            
            const todayTotalGames = todayWins + todayLosses;
            if (todayTotalGames >= 3) {
              updatedData.attendanceCount = FieldValue.increment(1);
            }
        }
    }
    
    batch.update(playerRef, updatedData);
  });

  await batch.commit();
  logger.log(`1단계: 오늘의 기록 합산 및 초기화 완료. (${playersToUpdate.length}명)`);
  
  const allPlayersSnapshotForRp = await playersRef.where("isGuest", "==", false).get();
  const rpBatch = db.batch();
  allPlayersSnapshotForRp.forEach(doc => {
      const player = doc.data();
      const newRP = 
          (player.wins || 0) * RP_CONFIG.WIN +
          (player.losses || 0) * RP_CONFIG.LOSS +
          (player.attendanceCount || 0) * RP_CONFIG.ATTENDANCE +
          ((player.winStreakCount || 0) * RP_CONFIG.WIN_STREAK_BONUS);
      rpBatch.update(doc.ref, { rp: newRP });
  });
  
  await rpBatch.commit();
  logger.log(`2단계: RP 재계산 완료. 모든 정산 작업이 성공적으로 끝났습니다.`);
  return `일일 정산 작업이 성공적으로 완료되었습니다. (${playersToUpdate.length}명 처리)`;
}

exports.dailyBatchUpdate = onSchedule({
  schedule: "10 22 * * *",
  timeZone: "Asia/Seoul",
}, async (event) => {
  try {
    await runDailyBatchUpdate();
  } catch (error) {
    logger.error("일일 정산 스케쥴 작업 중 오류 발생:", error);
  }
  return null;
});

exports.testDailyBatch = onCall({ cors: true }, async (request) => {
  logger.log("일일 정산 '테스트'를 시작합니다.");
  try {
      const message = await runDailyBatchUpdate();
      return { success: true, message: message };
  } catch (error) {
      logger.error("일일 정산 '테스트' 중 오류 발생:", error);
      throw new HttpsError('internal', '테스트 함수 실행 중 서버에서 오류가 발생했습니다.'); // [수정] 올바른 에러 클래스 사용
  }
});


// ============================================================================
// 2. 월간 랭킹 보관 로직 (기존 코드 유지)
// ============================================================================
async function archiveMonthlyRanking(db, isTest = false) {
  const playersRef = db.collection("players");
  
  const today = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstToday = new Date(today.getTime() + kstOffset);
  
  const previousMonth = new Date(kstToday.getFullYear(), kstToday.getMonth() - 1, 1);
  const year = previousMonth.getFullYear();
  const month = String(previousMonth.getMonth() + 1).padStart(2, '0');
  const docId = isTest ? `${year}-${month}-TEST` : `${year}-${month}`;

  const snapshot = await playersRef.where("isGuest", "==", false).get();
  if (snapshot.empty) {
    logger.log("랭킹을 만들 선수가 없어 함수를 종료합니다.");
    return "랭킹을 만들 선수가 없습니다.";
  }

  const rankedPlayers = snapshot.docs
    .map(doc => doc.data())
    .sort((a, b) => (b.rp || 0) - (a.rp || 0))
    .map((p, index) => ({
      id: p.id, name: p.name, rank: index + 1,
      rp: p.rp || 0, wins: p.wins || 0, losses: p.losses || 0,
      winStreakCount: p.winStreakCount || 0, attendanceCount: p.attendanceCount || 0,
    }));

  if (rankedPlayers.length > 0) {
    await db.collection("monthlyRankings").doc(docId).set({
      ranking: rankedPlayers,
      createdAt: FieldValue.serverTimestamp(),
    });
    logger.log(`${docId} 랭킹이 성공적으로 저장되었습니다.`);

    const notificationMessage = `${month}월 랭킹 정보를 정상적으로 저장하였습니다. 콕스타 랭킹정보를 모두 초기화 할까요?`;
    await db.collection("notifications").doc(ADMIN_ID).set({
      message: notificationMessage,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    logger.log(`관리자(${ADMIN_ID})에게 초기화 알림을 보냈습니다.`);
    return `'${docId}' 이름으로 랭킹이 저장되었고, 관리자에게 알림을 보냈습니다.`;
  } else {
    logger.log("랭크할 선수가 없어 월간 랭킹을 저장하지 않았습니다.");
    return "랭크할 선수가 없어 월간 랭킹을 저장하지 않았습니다.";
  }
}

exports.monthlyRankingArchive = onSchedule({
  schedule: "5 0 1 * *",
  timeZone: "Asia/Seoul",
}, async (event) => {
  logger.log("월간 랭킹 보관 작업을 시작합니다.");
  const db = getFirestore();
  try {
    await archiveMonthlyRanking(db, false);
  } catch (error) {
    logger.error("월간 랭킹 보관 작업 중 오류 발생:", error);
    await db.collection("notifications").doc(ADMIN_ID).set({
      message: "월간 랭킹 정보 저장 중 오류가 발생했습니다. 데이터를 보호하기 위해 초기화를 진행하지 않았습니다. 개발자에게 문의해주세요.",
      status: 'error',
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return null;
});

exports.testMonthlyArchive = onCall({ cors: true }, async (request) => {
    logger.log("월간 랭킹 보관 '테스트'를 시작합니다.");
    const db = getFirestore();
    try {
        const message = await archiveMonthlyRanking(db, true);
        return { success: true, message: message };
    } catch (error) {
        logger.error("월간 랭킹 '테스트' 중 오류 발생:", error);
        throw new functions.https.HttpsError('internal', '테스트 함수 실행 중 서버에서 오류가 발생했습니다.');
    }
});


// ============================================================================
// 중복 알림 방지를 위한 전역 캐시 (Cloud Functions 메모리 활용)
// ============================================================================
const recentNotifications = new Map();

// ============================================================================
// 3. 경기 시작 푸시 알림 로직
// ============================================================================
exports.sendMatchNotification = onCall({ cors: true }, async (request) => {
    const data = request.data || {};
    const playerIds = Array.isArray(data.playerIds) ? data.playerIds : [];
    const courtIndex = data.courtIndex || 0;

    if (playerIds.length === 0) {
        return { success: false, message: "알림을 보낼 선수가 없습니다." };
    }

    // 중복 알림 방지 로직 완전 제거 (무조건 전송)

    const db = getFirestore();
    const tokens = [];

    try {
        const tokenToDocRef = {};
        // [수정] 빈 문자열, null 등 유효하지 않은 ID 완벽 필터링
        const validIds = playerIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
        
        if (validIds.length > 0) {
            const promises = validIds.map(id => db.collection('players').doc(id).get());
            const snapshots = await Promise.all(promises);

            snapshots.forEach(snap => {
                if (snap.exists) {
                    const playerData = snap.data();
                    if (playerData.fcmTokens && Array.isArray(playerData.fcmTokens)) {
                        playerData.fcmTokens.forEach(token => {
                            if (token && typeof token === 'string') { 
                                tokens.push(token);
                                tokenToDocRef[token] = snap.ref;
                            }
                        });
                    }
                }
            });
        }

        const uniqueTokens = [...new Set(tokens)];

        if (uniqueTokens.length === 0) {
            logger.log("전송할 휴대폰 주소(토큰)가 없어 알림을 보내지 않습니다.");
            return { success: false, message: "전송할 토큰 없음" };
        }

       const message = {
            notification: {
                title: '🏸 경기 시작!',
                body: `${courtIndex + 1}번 코트에서 경기가 시작되었습니다. 코트로 이동해주세요!`,
            },
            data: {
                title: '🏸 경기 시작!',
                body: `${courtIndex + 1}번 코트에서 경기가 시작되었습니다. 코트로 이동해주세요!`,
            },
            android: { priority: 'high' },
            apns: { payload: { aps: { contentAvailable: true } } },
            tokens: uniqueTokens,
        };
        const response = await getMessaging().sendEachForMulticast(message);
        
        if (response.failureCount > 0) {
            const failedTokensToRemove = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    if (errorCode === 'messaging/invalid-registration-token' || 
                        errorCode === 'messaging/registration-token-not-registered') {
                        
                        const badToken = uniqueTokens[idx];
                        const playerRef = tokenToDocRef[badToken];
                        if (playerRef) {
                            failedTokensToRemove.push(playerRef.update({ fcmTokens: FieldValue.arrayRemove(badToken) }));
                        }
                    }
                }
            });
            if (failedTokensToRemove.length > 0) await Promise.all(failedTokensToRemove);
        }

       return { success: true, successCount: response.successCount };
    } catch (error) {
        logger.error("대기 알림 전송 에러:", error);
        // [수정] 올바른 에러 클래스(HttpsError) 사용하여 서버 크래시 및 CORS 에러 원천 차단
        throw new HttpsError('internal', '대기 알림 문제 발생: ' + error.message);
    }
});

// ============================================================================
// 5. 매일 새벽 2시 경기방 및 선수 일일 히스토리 강제 초기화 로직
// ============================================================================
exports.dailyRoomCleanup = onSchedule({
    schedule: "0 2 * * *",
    timeZone: "Asia/Seoul",
}, async (event) => {
    logger.log("새벽 2시 경기방 및 선수 일일 히스토리 강제 초기화 작업을 시작합니다.");
    const db = getFirestore();
    
    try {
        // 1. 경기방 (gameState) 초기화: 경기예정, 경기진행, 경기대기 내보내기
        const gameStateRef = db.collection("gameState").doc("live");
        const gameStateDoc = await gameStateRef.get();
        
        if (gameStateDoc.exists) {
            const data = gameStateDoc.data();
            const numInProgressCourts = data.numInProgressCourts || 4;
            
            await gameStateRef.update({
                inProgressCourts: Array(numInProgressCourts).fill(null), // 경기진행 비우기
                scheduledMatches: {}, // 경기예정 비우기
                autoQueue: [] // 경기대기(대기열) 비우기
            });
            logger.log("경기방(경기진행, 경기예정, 경기대기) 모든 선수 내보내기 완료.");
        }

        // 2. 모든 선수의 일일 히스토리 및 게임수 강제 초기화
        const playersRef = db.collection("players");
        const allPlayersSnapshot = await playersRef.get();
        
        if (!allPlayersSnapshot.empty) {
            const batches = [];
            let currentBatch = db.batch();
            let count = 0;
            
            allPlayersSnapshot.forEach(doc => {
                currentBatch.update(doc.ref, {
                    todayWins: 0,
                    todayLosses: 0,
                    todayWinStreakCount: 0,
                    todayRecentGames: []
                });
                count++;
                
                // Firestore batch 제한(500개)을 피하기 위해 400개 단위로 분할 처리
                if (count % 400 === 0) {
                    batches.push(currentBatch.commit());
                    currentBatch = db.batch();
                }
            });
            
            if (count % 400 !== 0) {
                batches.push(currentBatch.commit());
            }
            
            await Promise.all(batches);
            logger.log(`총 ${count}명의 선수 일일 데이터 및 히스토리 초기화 완료.`);
        }
    } catch (error) {
        logger.error("새벽 2시 초기화 작업 중 에러 발생:", error);
    }
    return null;
});

// 관리자 화면 등에서 즉시 비우기를 실행해볼 수 있는 테스트용 함수 (선택사항)
exports.testDailyRoomCleanup = onCall({ cors: true }, async (request) => {
    logger.log("새벽 2시 초기화 로직 '테스트'를 시작합니다.");
    const db = getFirestore();
    
    try {
        const gameStateRef = db.collection("gameState").doc("live");
        const gameStateDoc = await gameStateRef.get();
        
        if (gameStateDoc.exists) {
            const data = gameStateDoc.data();
            const numInProgressCourts = data.numInProgressCourts || 4;
            
            await gameStateRef.update({
                inProgressCourts: Array(numInProgressCourts).fill(null),
                scheduledMatches: {},
                autoQueue: []
            });
        }

        const playersRef = db.collection("players");
        const allPlayersSnapshot = await playersRef.get();
        let count = 0;
        
        if (!allPlayersSnapshot.empty) {
            const batches = [];
            let currentBatch = db.batch();
            
            allPlayersSnapshot.forEach(doc => {
                currentBatch.update(doc.ref, {
                    todayWins: 0,
                    todayLosses: 0,
                    todayWinStreakCount: 0,
                    todayRecentGames: []
                });
                count++;
                
                if (count % 400 === 0) {
                    batches.push(currentBatch.commit());
                    currentBatch = db.batch();
                }
            });
            
            if (count % 400 !== 0) {
                batches.push(currentBatch.commit());
            }
            await Promise.all(batches);
        }
        return { success: true, message: `경기방이 비워지고 ${count}명의 선수 데이터가 초기화되었습니다.` };
    } catch (error) {
        logger.error("초기화 테스트 중 에러 발생:", error);
        throw new HttpsError('internal', '초기화 테스트 중 문제가 발생했습니다: ' + error.message);
    }
});

// ============================================================================
// 4. 경기 대기 1번 푸시 알림 로직
// ============================================================================
exports.sendWaitingNotification = onCall({ cors: true }, async (request) => {
    const data = request.data || {};
    const playerIds = Array.isArray(data.playerIds) ? data.playerIds : [];
    const matchType = data.matchType || 'schedule'; 

    if (playerIds.length === 0) {
        return { success: false, message: "알림을 보낼 선수가 없습니다." };
    }

    // 중복 알림 방지 로직 완전 제거 (무조건 전송)

    const db = getFirestore();
    const tokens = [];

    try {
        const tokenToDocRef = {};
        const validIds = playerIds.filter(id => id && typeof id === 'string' && id.trim() !== '');

        if (validIds.length > 0) {
            const promises = validIds.map(id => db.collection('players').doc(id).get());
            const snapshots = await Promise.all(promises);

            snapshots.forEach(snap => {
                if (snap.exists) {
                    const playerData = snap.data();
                    if (playerData.fcmTokens && Array.isArray(playerData.fcmTokens)) {
                        playerData.fcmTokens.forEach(token => {
                            if (token && typeof token === 'string') {
                                tokens.push(token);
                                tokenToDocRef[token] = snap.ref;
                            }
                        });
                    }
                }
            });
        }

        const uniqueTokens = [...new Set(tokens)];

        if (uniqueTokens.length === 0) return { success: false, message: "전송할 토큰 없음" };

        const typeLabel = matchType === 'auto' ? '자동매칭' : '경기예정';
        
        const message = {
            notification: {
                title: '⏳ 경기대기 1번입니다!',
                body: `${typeLabel} 1번으로 배정되었습니다. 곧 경기가 시작되니 코트 주변에서 몸 풀고 준비해 주세요!`,
            },
            data: {
                title: '⏳ 경기대기 1번입니다!',
                body: `${typeLabel} 1번으로 배정되었습니다. 곧 경기가 시작되니 코트 주변에서 몸 풀고 준비해 주세요!`,
            },
            android: { priority: 'high' },
            apns: { payload: { aps: { contentAvailable: true } } },
            tokens: uniqueTokens,
        };
        const response = await getMessaging().sendEachForMulticast(message);
        
        if (response.failureCount > 0) {
            const failedTokensToRemove = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    if (errorCode === 'messaging/invalid-registration-token' || 
                        errorCode === 'messaging/registration-token-not-registered') {
                        const badToken = uniqueTokens[idx];
                        const playerRef = tokenToDocRef[badToken];
                        if (playerRef) {
                            failedTokensToRemove.push(playerRef.update({ fcmTokens: FieldValue.arrayRemove(badToken) }));
                        }
                    }
                }
            });
            if (failedTokensToRemove.length > 0) await Promise.all(failedTokensToRemove);
        }

        return { success: true, successCount: response.successCount };
    } catch (error) {
        logger.error("대기 알림 전송 에러:", error);
        // [수정] 올바른 에러 클래스(HttpsError) 사용하여 서버 크래시 및 CORS 에러 원천 차단
        throw new HttpsError('internal', '대기 알림 문제 발생: ' + error.message);
    }
});
