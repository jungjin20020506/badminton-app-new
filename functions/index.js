const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const RP_CONFIG = { WIN: 30, LOSS: 10, ATTENDANCE: 20, WIN_STREAK_BONUS: 20 };
const ADMIN_ID = "정형진"; 

// [MODIFIED] 'runDailyBatchUpdate' 함수 로직 수정
async function runDailyBatchUpdate() {
  logger.log("매일 선수 데이터 정산 작업을 시작합니다.");

  const db = getFirestore();
  const playersRef = db.collection("players");
  
  // 1. 'status'와 관계없이 모든 플레이어 문서를 가져옵니다.
  const allPlayersSnapshot = await playersRef.get();
  if (allPlayersSnapshot.empty) {
    logger.log("등록된 선수가 없어 함수를 종료합니다.");
    return "등록된 선수가 없습니다.";
  }

  // 2. 오늘 경기 기록(todayWins 또는 todayLosses)이 있는 선수만 필터링합니다.
  const playersToUpdate = [];
  allPlayersSnapshot.forEach(doc => {
    const player = doc.data();
    const todayWins = player.todayWins || 0;
    const todayLosses = player.todayLosses || 0;
    if (todayWins > 0 || todayLosses > 0) {
      playersToUpdate.push({ ref: doc.ref, data: player });
    }
  });

  // 3. 업데이트할 선수가 없으면 작업을 종료합니다.
  if (playersToUpdate.length === 0) {
    logger.log("오늘 경기 기록이 있는 선수가 없어 정산을 종료합니다.");
    return "정산할 선수가 없습니다.";
  }

  const batch = db.batch();
  
  // 4. 필터링된 선수들에 대해서만 배치 업데이트를 실행합니다.
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
      throw new functions.https.HttpsError('internal', '테스트 함수 실행 중 서버에서 오류가 발생했습니다.');
  }
});


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
