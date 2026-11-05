# ⚡ COCKSLIGHTING — 배드민턴 동호회 실시간 경기 운영 앱

체육관에서 그날 운동을 굴리는 데 쓰는 실시간 웹앱입니다. 누가 왔는지, 지금 어느 코트에서 누가 치는지, 다음 경기는 누구인지를 모든 회원이 자기 폰에서 실시간으로 봅니다. 관리자는 버튼 몇 번으로 경기를 짜고 시작·종료시킵니다.

- 배포 주소: https://badminton-app-new.vercel.app
- 전체 기능 명세: [앱_전체_기능_명세.md](./앱_전체_기능_명세.md)
- 새벽 2시 초기화 안내: [새벽2시_초기화_가이드.md](./새벽2시_초기화_가이드.md)
- 변경 이력: [CHANGELOG.md](./CHANGELOG.md)

## 기술 스택

| 항목 | 내용 |
|---|---|
| 프론트엔드 | React 19 + Vite 7 (JavaScript, JSDoc 타입) |
| 스타일 | Tailwind CSS 3.4 + `src/styles/*.css` (디자인 토큰 기반, 다크/라이트) |
| 데이터 | Firebase Firestore (실시간 구독) + Storage(공지 사진) |
| 서버 | Vercel Serverless (`api/`) — 소모임 연동, 크론(새벽 초기화·예약 정리) |
| PWA | vite-plugin-pwa (홈 화면 설치), 빌드 번호 비교로 자동 업데이트 |
| 품질 | ESLint 9, Vitest(시뮬레이터 포함), GitHub Actions CI, Lighthouse |
| 모니터링 | Sentry (선택, `VITE_SENTRY_DSN` 있을 때만) |

## 시작하기

```bash
npm ci
npm run dev        # http://localhost:5173
```

```bash
npm run build      # 프로덕션 빌드 → dist/
npm run preview    # 빌드 결과 미리보기
npm run lint       # ESLint
npm test           # Vitest (단위 테스트 + 매칭 시뮬레이터 2종)
npm run test:sim   # 시뮬레이터만 직접 실행 (자세한 출력)
```

> ⚠️ 로컬에서 띄워도 **프로덕션 Firebase에 그대로 연결**됩니다. 그날 처음 앱을 여는 기기에서 새벽 2시 초기화가 실행되므로, 운동 시간(저녁)에는 테스트를 피하세요.

## 배포

`main` 브랜치에 푸시하면 Vercel이 자동으로 배포합니다. 배포 직후부터 회원 기기는 아래 규칙으로 최신 버전으로 바뀝니다.

- 앱이 켜질 때, 다른 앱에 갔다가 1분 넘게 지나 돌아올 때, 새 버전이 떠 있는데 2분간 조작이 없을 때 **자동 새로고침**
- 그 외에는 배너로 안내하고 버튼을 누르면 즉시 적용

CI(`.github/workflows/ci.yml`)는 린트·테스트·빌드를 돌리지만 Vercel 배포를 막지는 않습니다. 막고 싶다면 GitHub 브랜치 보호 규칙에서 `ci` 체크를 필수로 지정하고 PR로만 합치세요.

## 환경변수 (Vercel → Settings → Environment Variables)

| 이름 | 용도 | 필수 |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | 서버 크론이 Firestore에 쓰기 위한 서비스 계정 JSON (한 줄) | 크론 쓰려면 |
| `CRON_SECRET` | 크론 엔드포인트 인증 토큰 (아무 긴 문자열) | 크론 쓰려면 |
| `VITE_SENTRY_DSN` | 오류 수집(Sentry). 없으면 모니터링이 꺼진 채 동작 | 선택 |

### 서버 크론 설정 (새벽 초기화 · 예약 경기 정리)

1. Firebase 콘솔 → 프로젝트 설정 → **서비스 계정** → 새 비공개 키 생성 → JSON 내용 전체를 `FIREBASE_SERVICE_ACCOUNT`에 넣습니다.
2. `CRON_SECRET`에 임의의 긴 문자열을 넣습니다. Vercel은 크론 호출 시 이 값을 `Authorization: Bearer …` 헤더로 자동 첨부합니다.
3. 재배포하면 `vercel.json`의 크론(`/api/cron/daily-reset`, 매일 02:05 KST)이 동작합니다.
4. `/api/cron/repair-queues`(막힌 예약 경기 정리)는 5분마다 돌리는 것이 좋지만 Vercel Hobby 플랜은 하루 1회 크론만 허용합니다. Pro 플랜이면 `vercel.json`에 `"*/5 * * * *"`로 추가하고, 아니면 cron-job.org 같은 무료 스케줄러에서 아래처럼 호출하세요.
   ```
   GET https://badminton-app-new.vercel.app/api/cron/repair-queues
   Authorization: Bearer <CRON_SECRET>
   ```

두 크론 모두 환경변수가 없으면 아무 일도 하지 않고 501을 돌려줍니다. 클라이언트 쪽 안전망(첫 접속 기기의 초기화, 관리자 화면의 예약 정리)은 그대로 남아 있습니다.

## 프로젝트 구조

```
api/                  Vercel 서버리스 함수 (somoim 연동, cron/*)
public/               정적 파일 (PWA 아이콘, 서비스워커, og-image)
scripts/              매칭 시뮬레이터·히든 키 생성·OG 이미지 원본
src/
  App.jsx             화면 조립과 핵심 핸들러
  hooks/              당겨서 새로고침, 스와이프, FLIP, 인앱 브라우저 등 화면 훅
  components/         섹션·카드·모달(modals/)·시스템 UI(토스트, 연결 띠, 오류 화면)
  lib/                firebase(데이터), matching(엔진), helpers, ranking, appUpdate, theme, logger …
  styles/             01-base … 14-theme-light (순서가 우선순위)
  tutorial/           첫 접속 튜트리얼 · 자동매칭 게임형 안내
tests/                Vitest (helpers, ranking, dates, matching, 시뮬레이터)
```

## 디자인 시스템

- 토큰은 `src/styles/02-tokens.css`(다크)와 `14-theme-light.css`(라이트)에 있습니다. 색을 바꿀 때 컴포넌트 CSS를 고치지 말고 토큰을 바꾸세요.
- 모달은 모두 `components/modals/ModalShell.jsx`를 씁니다 (role=dialog, 포커스 가두기, Esc·배경 탭 닫기, 뒤로가기 닫기).
- 라임(`--volt`)은 다크에서는 글자에도 쓰지만, 라이트에서는 **채움에만** 쓰고 글자는 `--volt-ink`를 씁니다 (흰 바탕 위 라임 글자는 안 보입니다).
- 아이콘은 `components/Icons.jsx`의 인라인 SVG입니다 (Font Awesome 제거).

## 링크 미리보기 이미지

카카오톡 등에 링크를 올릴 때 보이는 카드(`public/og-image.png`)의 원본은 `scripts/og-image.html`입니다. 바꾼 뒤에는 https://developers.kakao.com/tool/clear/og 에서 캐시를 지워야 새 카드가 보입니다.

## 남은 과제 (의도적으로 이번에 하지 않은 것)

- **선수 id = 이름 구조 분리** — 지금은 `generateId(이름)`이 `players`·`roster` 문서 id라서 이름을 바꿀 수 없고 동명이인을 구분하지 못합니다. 바꾸려면 ① `roster`에 `uid`(임의 문자열)를 추가하고 `players` 문서 id를 `uid`로 ② 기존 문서를 한 번에 이주하는 스크립트 ③ 입장 화면은 이름 → uid 조회로 바꾸는 3단계가 필요합니다. 운영 중 데이터 이주라 운동이 없는 날에 따로 진행해야 합니다.
- **접속 표시를 Realtime Database `onDisconnect`로** — Firebase 콘솔에서 Realtime Database를 먼저 만들어야 해서 코드만으로는 바꿀 수 없습니다. 지금은 70초 하트비트(단일 문서)로 동작합니다.
- **카드 목록 가상화** — 카드가 60장 이하라 FLIP 애니메이션과의 충돌 위험 대비 이득이 작아 보류했습니다.
- **React Compiler** — 자동 메모이제이션은 이득이 크지만 아직 실험 단계라 운영 앱에는 넣지 않았습니다.
- **폰트 자체 호스팅** — Noto Sans KR은 Google Fonts가 글자 범위별로 나눠 주는 편이 더 빠릅니다. preload만 추가했습니다.
