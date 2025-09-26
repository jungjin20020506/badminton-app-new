const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const RP_CONFIG = { WIN: 30, LOSS: 10, ATTENDANCE: 20, WIN_STREAK_BONUS: 20 };
const ADMIN_ID = "정형진"; // 알림을 받을 관리자 ID

/**
 * 매일 밤 22시 10분(한국 시간)에 실행되어 오늘의 기록을 누적 기록에 합산하고 RP를 재계산합니다.
 * 그 다음, 다음 날 경기를 위해 오늘의 기록을 초기화합니다.
 */
exports.dailyBatchUpdate = onSchedule({
  schedule: "10 22 * * *",
  timeZone: "Asia/Seoul",
}, async (event) => {
  logger.log("매일 선수 데이터 정산 작업을 시작합니다.");

  const db = getFirestore();
  const playersRef = db.collection("players");
  
  try {
    const snapshot = await playersRef.get();
    if (snapshot.empty) {
      logger.log("정산할 선수가 없어 함수를 종료합니다.");
      return null;
    }

    const batch = db.batch();
    
    snapshot.forEach(doc => {
      const player = doc.data();
      const playerRef = playersRef.doc(doc.id);

      const todayWins = player.todayWins || 0;
      const todayLosses = player.todayLosses || 0;
      
      if (player.status === 'active' || todayWins > 0 || todayLosses > 0) {
        const updatedData = {
          todayWins: 0,
          todayLosses: 0,
          status: 'inactive',
        };

        if (!player.isGuest) {
          const prevTotalGames = (player.wins || 0) + (player.losses || 0);
          const newTotalGames = prevTotalGames + todayWins + todayLosses;
          
          updatedData.wins = FieldValue.increment(todayWins);
          updatedData.losses = FieldValue.increment(todayLosses);
          
          if (prevTotalGames < 3 && newTotalGames >= 3) {
            updatedData.attendanceCount = FieldValue.increment(1);
          }
        }
        batch.update(playerRef, updatedData);
      }
    });

    await batch.commit();
    logger.log(`1단계: 오늘의 기록 합산 및 초기화 완료.`);
    
    // RP 재계산
    const finalSnapshot = await playersRef.get();
    const rpBatch = db.batch();
    finalSnapshot.forEach(doc => {
        const player = doc.data();
        if (!player.isGuest) {
            const newRP = 
                (player.wins || 0) * RP_CONFIG.WIN +
                (player.losses || 0) * RP_CONFIG.LOSS +
                (player.attendanceCount || 0) * RP_CONFIG.ATTENDANCE +
                (Math.floor((player.winStreak || 0) / 3) * RP_CONFIG.WIN_STREAK_BONUS);
            rpBatch.update(doc.ref, { rp: newRP });
        }
    });
    
    await rpBatch.commit();
    logger.log(`2단계: RP 재계산 완료. 모든 정산 작업이 성공적으로 끝났습니다.`);

  } catch (error) {
    logger.error("일일 정산 작업 중 오류 발생:", error);
  }
  return null;
});

/**
 * 매월 1일 0시 5분(한국 시간)에 실행되어 지난달의 최종 랭킹을 저장하고
 * 관리자에게 랭킹 초기화 알림을 보냅니다.
 */
exports.monthlyRankingArchive = onSchedule({
  schedule: "5 0 1 * *",
  timeZone: "Asia/Seoul",
}, async (event) => {
  logger.log("월간 랭킹 보관 작업을 시작합니다.");

  const db = getFirestore();
  const playersRef = db.collection("players");
  
  try {
    const today = new Date();
    today.setHours(today.getHours() + 9); // KST
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const year = previousMonth.getFullYear();
    const month = String(previousMonth.getMonth() + 1).padStart(2, '0');
    const docId = `${year}-${month}`; // 예: "2025-09"

    const snapshot = await playersRef.get();
    if (snapshot.empty) {
      logger.log("랭킹을 만들 선수가 없어 함수를 종료합니다.");
      return null;
    }

    const rankedPlayers = snapshot.docs
      .map(doc => doc.data())
      .filter(p => !p.isGuest)
      .sort((a, b) => (b.rp || 0) - (a.rp || 0))
      .map((p, index) => ({
        id: p.id,
        name: p.name,
        rank: index + 1,
        rp: p.rp || 0,
        wins: p.wins || 0,
        losses: p.losses || 0,
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
    } else {
      logger.log("랭크할 선수가 없어 월간 랭킹을 저장하지 않았습니다.");
    }
  } catch (error) {
    logger.error("월간 랭킹 보관 작업 중 오류 발생:", error);
    // [NEW] 오류 발생 시 관리자에게 오류 알림 전송
    await db.collection("notifications").doc(ADMIN_ID).set({
      message: "월간 랭킹 정보 저장 중 오류가 발생했습니다. 데이터를 보호하기 위해 초기화를 진행하지 않았습니다. 개발자에게 문의해주세요.",
      status: 'error',
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return null;
});

