const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const RP_CONFIG = { WIN: 30, LOSS: 10, ATTENDANCE: 20, WIN_STREAK_BONUS: 20 };
// [FIX] ID 생성 시 공백을 제거해야 하므로, Cloud Function 내에서도 동일한 로직을 사용하도록 수정합니다.
// 하지만 여기서는 간단하게 공백 없는 이름을 사용합니다.
const ADMIN_ID = "정형진"; 

/**
 * 매일 밤 22시 10분(한국 시간)에 실행되어 오늘의 기록을 누적 기록에 합산하고 RP를 재계산합니다.
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
      
      // 오늘 활동한 선수만 업데이트
      if (todayWins > 0 || todayLosses > 0) {
        const updatedData = {
          todayWins: 0,
          todayLosses: 0,
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
      } else if (player.status === 'active') {
        // 게임은 안했지만 접속해있던 유저 상태 변경
        batch.update(playerRef, { status: 'inactive' });
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
 * 월간 랭킹 보관 로직을 수행하는 재사용 가능한 함수
 * @param {Firestore} db - Firestore 인스턴스
 * @param {boolean} isTest - 테스트 실행 여부
 * @returns {Promise<string>} - 작업 결과 메시지
 */
async function archiveMonthlyRanking(db, isTest = false) {
  const playersRef = db.collection("players");
  
  const today = new Date();
  // KST (UTC+9) 기준으로 날짜 계산
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

/**
 * 매월 1일 0시 5분(한국 시간)에 실행되어 지난달의 최종 랭킹을 저장합니다.
 */
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


/**
 * 웹사이트에서 수동으로 호출하여 월간 랭킹 보관 기능을 테스트하는 함수
 */
exports.testMonthlyArchive = onCall(async (request) => {
    logger.log("월간 랭킹 보관 '테스트'를 시작합니다.");
    const db = getFirestore();
    try {
        const message = await archiveMonthlyRanking(db, true); // isTest=true로 호출
        return { success: true, message: message };
    } catch (error) {
        logger.error("월간 랭킹 '테스트' 중 오류 발생:", error);
        throw new functions.https.HttpsError('internal', '테스트 함수 실행 중 서버에서 오류가 발생했습니다.');
    }
});

