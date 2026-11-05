import React from 'react';

// ===================================================================================
// [튜트리얼] 단계 정의 — 관리자용 / 사용자용 (Tutorial.jsx 에서 분리)
// -----------------------------------------------------------------------------------
//   target       : 스포트라이트 선택자(data-tut). 없으면 화면 중앙 카드
//   surface      : 그 단계에서 열어 둘 화면 ('main' | 'menu' | 'settings' | 'roster')
//   tab          : 모바일에서 전환할 탭 ('matching' | 'inProgress')
//   only         : 'mobile' | 'desktop' — 해당 환경에서만 표시
//   mode         : 'team' | 'normal' — [청백전] 해당 경기 방식일 때만 표시 (없으면 항상)
//   interactive  : true면 화면 조작을 막지 않는다 (직접 해보기 단계)
//   advanceOnTab : 사용자가 이 탭으로 이동하면 자동으로 다음 단계로
// ===================================================================================

// ── 관리자용 튜트리얼 — 핵심만 짧게 ──
const TUTORIAL_ADMIN_STEPS = [
    {
        title: '화면은 딱 3칸이에요',
        body: (<>
            <b>대기 명단</b> → <b>자동 매칭·경기 예정</b> → <b>경기 진행</b>.
            <br/>선수는 왼쪽에서 오른쪽으로 흘러갑니다. 끝!
        </>),
    },
    {
        target: '[data-tut="waiting"]', tab: 'matching',
        title: '① 대기 명단',
        body: (<>
            <span className="tut-key">탭</span> 선택 ·
            <span className="tut-key">✕</span> 내보내기 ·
            <span className="tut-key">1초 꾹</span> 선수 관리(휴식·게임 수·기록)
        </>),
    },
    {
        mode: 'team', target: '[data-tut="team-board"]', tab: 'matching',
        title: '⚔️ 청백전 점수판',
        body: (<>
            <span className="tut-key">탭</span> 오늘 득점 기록 ·
            <span className="tut-key">1초 꾹</span> 점수 수정
            <br/>경기 종료 때 <b>이긴 팀</b>을 고르면 여기 점수가 오르고, 선수 카드에 <b>승·패</b>가 쌓여요.
        </>),
    },
    {
        mode: 'team', target: '[data-tut="team-rank"]', tab: 'matching',
        title: '🏆 오늘의 순위',
        body: (<>
            <b>전체 / 청팀 / 백팀</b>을 눌러 바꿔 보세요. 승률순이고, 각 팀 1위는 카드에 ⭐가 붙어요.
        </>),
    },
    {
        mode: 'normal', target: '[data-tut="auto-make"]', tab: 'matching',
        title: '② 자동 매칭 — 골라서 만들어요',
        body: (<>
            <b>남자 / 여자 / 혼복</b> 버튼을 누르면 <b>후보 6개</b>가 이유와 함께 떠요.
            <br/><b>베스트 2 · 보통 2 · 아쉬움 2</b> 중에서 골라 탭하면 목록에 들어갑니다.
            <br/>자세한 설명: 내 메뉴 ▸ <b>🤖 자동매칭 새 기능</b>
        </>),
    },
    {
        mode: 'normal', target: '[data-tut="auto"]', tab: 'matching',
        title: '만든 경기 다듬기',
        body: (<>
            카드 <span className="tut-key">탭↔탭</span> 자리 교환 ·
            <span className="tut-key">번호 꾹</span> 경기 삭제 ·
            <span className="tut-key">START</span> 경기 시작
            <br/><b>회색 「경기중」</b> 카드가 있으면 그 코트가 끝나야 START가 켜져요.
        </>),
    },
    {
        mode: 'normal', target: '[data-tut="scheduled"]', tab: 'matching',
        title: '③ 경기 예정 — 직접 짤 때',
        body: (<>
            대기에서 <b>선수 탭</b> → 여기 <b>빈칸 탭</b>이면 배정 완료.
        </>),
    },
    {
        mode: 'team', target: '[data-tut="scheduled"]', tab: 'matching',
        title: '경기 예정 — 청 2칸 · 백 2칸',
        body: (<>
            대기에서 <b>선수 탭</b> → <b>자기 팀 칸 탭</b>. 왼쪽 2칸은 청팀, 오른쪽 2칸은 백팀 자리예요.
            <br/>다른 팀 칸에 넣으면 안내가 뜨고 들어가지 않아요.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '④ 경기 진행',
        body: (<>
            <span className="tut-key">FINISH</span> 경기 종료 + 기록 저장
            <br/><span className="tut-key">코트 번호 꾹</span> → 다른 코트 탭 = <b>코트 이동/교환</b>
        </>),
    },
    {
        only: 'mobile', interactive: true, advanceOnTab: 'inProgress', tab: 'matching',
        title: '직접 해보세요! 👈',
        body: (<>
            화면을 <b>왼쪽으로 밀어보세요</b> — 경기 진행 화면으로 넘어갑니다.
            <br/>(오른쪽으로 밀면 다시 돌아와요)
        </>),
    },
    {
        surface: 'menu', target: '[data-tut="menu"]',
        title: '내 메뉴',
        body: (<>
            <b>관리자 설정</b> · <b>튜트리얼 다시 보기</b> · <b>테마</b> · <b>나가기</b>가 여기 있어요.
            <br/>휴식은 프로필 왼쪽의 <b>☕ 버튼</b>으로 바로!
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-auto"]',
        title: '설정 — 매칭 민감도',
        body: (<>
            <b>경기중인 선수를 몇 명까지 미리 예약할지</b>를 정합니다.
            <br/><b>낮음</b> 0명(바로 시작) · <b>보통</b> 1명 · <b>높음</b> 2명 · <b>최고</b> 제한 없음.
            <br/>모르면 <em>보통</em>, 사람이 많은 날은 <em>높음</em>.
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-summary"]',
        title: '하루 요약 카드 📸',
        body: (<>
            운동 끝나고 누르면 <b>오늘의 리포트 카드</b>가 만들어져요 → 단톡방에 공유!
            <br/>코트 수·공지·선수 명단·관리자 부여도 모두 이 설정창에 있습니다.
        </>),
    },
    {
        title: '끝! 나머지는 자동이에요 🎉',
        body: (<>
            <b>새벽 2시</b> 초기화 · <b>정모날 18시</b> 참석자 자동 입장.
            <br/>하루 운영 = <em>매칭 만들기 → START → FINISH</em> 반복. 화이팅!
        </>),
    },
];

// ── 사용자용 튜트리얼 — 1분 컷 ──
const TUTORIAL_USER_STEPS = [
    {
        title: '콕스타, 1분이면 배워요',
        body: (<>
            다음 경기 <b>4명을 시스템이 공평하게</b> 정해줍니다.
            <br/>여러분은 <b>화면만 보고 있으면</b> 돼요!
        </>),
    },
    {
        target: '[data-tut="waiting"]', tab: 'matching',
        title: '① 내 카드',
        body: (<>
            <b>주황 테두리</b>가 나예요. <b>3G</b> = 오늘 3경기.
            <br/><b>내 카드를 탭하면</b> 오늘 누구와 쳤는지 기록이 보여요.
            아래 가운데 ⌖ 버튼은 내 카드를 찾아줍니다.
        </>),
    },
    {
        mode: 'team', target: '[data-tut="team-board"]', tab: 'matching',
        title: '⚔️ 청백전 점수판',
        body: (<>
            <b>점수판을 탭하면</b> 오늘 누가 어느 코트에서 득점했는지 기록이 보여요.
            <br/>내 카드 아래 <b>승·패</b>도 경기가 끝날 때마다 올라갑니다.
        </>),
    },
    {
        mode: 'team', target: '[data-tut="team-rank"]', tab: 'matching',
        title: '🏆 오늘의 순위',
        body: (<>
            <b>전체 / 청팀 / 백팀</b> 승률 순위. 내 줄은 주황색으로 표시돼요. 각 팀 1위는 ⭐!
        </>),
    },
    {
        mode: 'normal', target: '[data-tut="auto"]', tab: 'matching',
        title: '② 자동 매칭 ★',
        body: (<>
            여기 <b>내 이름이 뜨면 다음 경기</b>예요!
            <br/><em>안 만난 사람끼리 · 오래 기다린 사람 먼저 · 급수 맞춰</em> — 아무도 소외되지 않게 뽑혀요.
            <br/>경기중이라도 뽑힐 수 있어요. 그때는 카드가 <b>회색 「경기중」</b>으로 보이다가,
            경기가 끝나면 색이 돌아옵니다.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '③ 경기 진행',
        body: (<>
            여기 내 이름이 뜨면 <b>그 번호 코트로</b> 가시면 됩니다!
        </>),
    },
    {
        only: 'mobile', interactive: true, advanceOnTab: 'inProgress', tab: 'matching',
        title: '직접 해보세요! 👈',
        body: (<>
            화면을 <b>왼쪽으로 밀어보세요</b> — 경기 진행 화면으로 넘어갑니다.
        </>),
    },
    {
        surface: 'main', target: '[data-tut="rest"]',
        title: '휴식할 때 · 집에 갈 때',
        body: (<>
            쉴 때는 위의 <b>☕ 휴식 버튼</b>(몇 분 쉴지 고르면 자동 복귀), 갈 때는 메뉴의 <b>나가기</b>를 꼭!
            <br/>안 누르면 없는 사람이 매칭에 잡혀요.
        </>),
    },
    {
        title: '끝! 즐겁게 운동하세요 🏸',
        body: (<>
            <em>입장 → 화면 보기 → 이름 뜨면 코트로</em>. 이게 전부예요.
            <br/>다시 보기: 내 메뉴 ▸ 튜트리얼 다시 보기
        </>),
    },
];

// [튜트리얼] 시작 화면 — 인사와 함께 들을지 말지 고른다

export { TUTORIAL_ADMIN_STEPS, TUTORIAL_USER_STEPS };
