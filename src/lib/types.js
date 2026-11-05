// ===================================================================================
// [타입] Firestore 문서와 앱 상태의 모양 — JSDoc typedef 모음
// -----------------------------------------------------------------------------------
// TypeScript 전환 전 단계로, 에디터(VS Code)가 자동완성과 타입 힌트를 줄 수 있도록
// 한 곳에 정의한다. 다른 파일에서는 아래처럼 참조한다.
//   /** @typedef {import('./types').Player} Player */
//   /** @param {Player} player */
// 런타임 코드는 없다 (import 해도 번들에 아무것도 들어가지 않는다).
// ===================================================================================

/**
 * 오늘 경기 기록 한 건. 한 경기의 4명 모두에게 같은 timestamp가 들어간다.
 * @typedef {object} GameRecord
 * @property {string} timestamp   ISO 시각
 * @property {string[]} partners  같은 편 선수 id (0~1명)
 * @property {string[]} opponents 상대 편 선수 id (0~2명)
 * @property {boolean} [isManual] 관리자가 손으로 넣은 보정 기록
 * @property {'win'|'loss'} [result] [청백전] 승/패
 * @property {('청'|'백')|null} [winnerTeam] [청백전] 이긴 팀 (팀이 섞인 경기는 null)
 */

/**
 * players/{id} — 선수 카드. 문서 id == generateId(name) == roster id
 * @typedef {object} Player
 * @property {string} id
 * @property {string} name
 * @property {'S조'|'A조'|'B조'|'C조'|'D조'|'N조'} level
 * @property {'남'|'여'} gender
 * @property {boolean} isGuest        게스트(랭킹 제외, 하늘색 급수)
 * @property {'active'|'inactive'} status  현황판에 있는지
 * @property {boolean} isResting       휴식 중
 * @property {string} [restUntil]      [휴식 타이머] 이 시각(ISO)이 지나면 자동 복귀
 * @property {string} entryTime        최초 입장 시각(ISO). 재입장해도 덮어쓰지 않음
 * @property {GameRecord[]} todayRecentGames 최신이 앞, 최대 20개
 * @property {('청'|'백')|null} [team]  [청백전] 소속 팀
 * @property {number} [todayWins]
 * @property {number} [todayLosses]
 * @property {number} [todayWinStreakCount]
 * @property {Object<string,string>} [tutorialSeen] { [mode]: ISO }
 * @property {number} [wins]  통산
 * @property {number} [losses]
 * @property {number} [rp]
 * @property {number} [attendanceCount]
 * @property {string[]} [fcmTokens]
 */

/**
 * 코트 한 칸. teamA = players[0..1], teamB = players[2..3]
 * @typedef {object} Court
 * @property {(string|null)[]} players  길이 4. 나간 선수는 null
 * @property {string} startTime         ISO
 * @property {string} matchId
 */

/**
 * gameState/live — 앱 상태의 심장
 * @typedef {object} GameState
 * @property {(Court|null)[]} inProgressCourts            길이 = numInProgressCourts
 * @property {Object<string, string[]>} autoMatches        "0","1",… 조밀하게 재인덱싱. 항상 4명
 * @property {Object<string, (string|null)[]>} scheduledMatches 길이 고정, null 섞일 수 있음
 * @property {number} numInProgressCourts
 * @property {number} numScheduledMatches
 * @property {string} [lastDailyResetKey]   YYYY-MM-DD (새벽 2시 기준 운영일)
 * @property {{blue:number, white:number}} [teamScores]  [청백전]
 * @property {object} [lastTeamResult]      [청백전] 득점 실황 배너 근거
 * @property {object[]} [teamResultLog]     [청백전] 최근 60건
 */

/**
 * config/season
 * @typedef {object} SeasonConfig
 * @property {string} announcement
 * @property {'none'|'simple'|'text'|'photo'} announcementType
 * @property {string} [announcementPhotoUrl]
 * @property {string} seasonId
 * @property {string[]} [adminNames]        빈 배열이면 기본값 사용
 * @property {'normal'|'team'} [matchMode]
 * @property {{sensitivity:string, perGenderSensitivity:boolean, maleSensitivity:string, femaleSensitivity:string}} autoMatchConfig
 */

/**
 * roster/{id} — 정회원 명단
 * @typedef {object} RosterEntry
 * @property {string} id
 * @property {string} name
 * @property {string} level
 * @property {'남'|'여'} gender
 * @property {string} [somoimMid]
 */

/**
 * 선수의 현재 위치 (calculateLocations 결과)
 * @typedef {object} PlayerLocation
 * @property {'waiting'|'schedule'|'auto'|'court'} location
 * @property {number} [matchIndex]
 * @property {number} [slotIndex]
 */

export {};
