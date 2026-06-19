# 다인아이앤씨 통합 대시보드 (ERP)

회사의 여러 시스템(노션·VAN사·채널톡·국세청)에 흩어진 데이터를 **한 화면에서 실시간으로 보는 통합 대시보드**입니다.
[master.md](../master.md)의 비전을 실제 동작하는 React 앱으로 구현한 것입니다.

> 이 문서는 **지금까지 만든 것 전체를 정리한 마스터 파일**입니다. 운영 서버(호스팅)는 [HOSTING.md](HOSTING.md)를 참고하세요.

---

## 1. 한눈에 보기

| 항목 | 내용 |
|------|------|
| **무엇** | 사내 운영 대시보드 (CS·매출·거래·가맹점·상담가이드) |
| **형태** | 웹 앱 (브라우저에서 접속) |
| **현재 단계** | 프로토타입 완료 → 운영 서버로 이전 준비 |
| **데이터 원본** | 노션, 코밴(KOVAN), 다우데이타(DDWM), 채널톡, 국세청 |
| **실행 위치(현재)** | 사내 PC (개발용) → **외부 서버로 이전 예정** |

---

## 2. 지금까지 만든 기능

| 메뉴 | 기능 | 데이터 출처 |
|------|------|-------------|
| **경영 지표** | 금일/월간/월평균/년간 매출, 전년 동기 대비 성장률, 월별 차트 | 노션 매출 DB(장비매출·할부/렌탈) |
| **거래(TR) 현황** | VAN사별(코밴·다우데이타) 월별 거래 건수 + 합산 | 코밴 CATECA, 다우데이타 DDWM |
| **무실적 가맹점** | 거래 없는 가맹점 목록(매장명·사업자번호), 작년매출·연락처, **국세청 폐업여부 조회** | 코밴·다우데이타 + 국세청 |
| **CS 현황** | 담당자별 실시간 상태(채널톡)·일일 처리/대기, 클릭 시 상담 매장 목록, **전화·채팅 인입 히트맵(요일×시간)** | 채널톡 Open API |
| **꿀팁게시판** | 상담원이 선택지를 따라가며 응대하는 가이드 Q&A(의사결정 트리), **AI 초안 자동 생성** | 수동 작성 + 채널톡 이력 + Claude AI |

> 일정 / 업무·할일 / 전체현황 일부는 아직 자리(placeholder)만 잡혀 있습니다.

---

## 3. 기술 스택 (쉽게 설명)

이 프로젝트는 크게 **① 화면(프론트엔드) ② 중계 서버(백엔드) ③ 자동 수집기(스크래퍼)** 세 부분입니다.

| 구분 | 도구 | 한 줄 설명 |
|------|------|-----------|
| 화면 | **React** | 버튼·표·차트 같은 화면 조각(컴포넌트)을 만드는 라이브러리 |
| 화면 | **TypeScript** | 자바스크립트에 "타입"을 더해 실수를 줄여주는 언어 |
| 화면 | **Vite** | 개발 서버 실행 + 배포용 빌드를 해주는 도구 |
| 중계 서버 | **Node.js** | 브라우저 밖에서 자바스크립트를 돌리는 실행 환경(서버) |
| 중계 서버 | **Express** | Node로 간단히 API 서버를 만드는 프레임워크 |
| 자동 수집 | **Playwright** | 사람이 브라우저를 쓰듯 자동 로그인·클릭·다운로드(스크래핑) |
| 데이터 처리 | **xlsx(SheetJS)** | 엑셀 파일을 읽어 데이터로 변환 |
| 데이터 처리 | **imapflow** | Gmail에서 인증번호 메일을 읽어옴(2차 인증 자동화) |
| 외부 연동 | **각 사 API** | 노션 / 채널톡 / 국세청 / Claude(AI) |
| 자동 실행 | **윈도우 작업 스케줄러** | 매일 정해진 시각에 수집기 자동 실행(→ 서버에선 cron) |
| 버전 관리 | **Git / GitHub** | 코드 변경 이력 관리 + 백업/공유 |

### "중계 서버(BFF)"가 왜 필요한가?
노션·채널톡 등의 **API 키(비밀번호)는 브라우저에 직접 넣으면 안 됩니다**(누구나 볼 수 있게 됨).
그래서 화면과 외부 서비스 사이에 **작은 서버(BFF, Backend-for-Frontend)** 를 두고 키는 서버만 갖게 합니다.
화면 → (우리 서버 `/api/...` 호출) → 서버가 키로 외부 API 호출 → 가공해 화면에 전달.

---

## 4. 아키텍처 (데이터 흐름)

```
[노션]  [코밴]  [다우데이타]  [채널톡]  [국세청]      ← 외부 데이터 원본
   │       │        │           │         │
   │   (Playwright 로그인·스크래핑 / API 호출)
   └───────┴────────┴───────────┴─────────┘
                     │
          ┌──────────▼───────────┐
          │   중계 서버 (BFF)      │  Node + Express  (server/notion-sales-bff.mjs)
          │  - 비밀키 보관         │  /api/sales, /api/tr, /api/inactive,
          │  - 외부 API 호출/가공  │  /api/cs, /api/calls, /api/playbooks ...
          └──────────┬───────────┘
                     │ (REST / JSON)
          ┌──────────▼───────────┐
          │  React 대시보드        │  Vite + React + TS  (src/)
          │  - 화면·표·차트         │  브라우저에서 접속
          └──────────────────────┘

[윈도우 작업 스케줄러] ─매일 08:00→ 수집기(server/*-scraper.mjs) → server/data/*.json
```

- **수집(스크래핑)** 은 매일 1회(또는 수동 "동기화" 버튼)로 `server/data/*.json` 에 저장 → 서버가 그 파일을 화면에 제공.
- **실시간 조회**(CS 현황 등)는 화면 열 때마다 서버가 채널톡 API를 즉시 호출.

---

## 5. 데이터 소스 / 연동 / 자격증명

모든 비밀키는 `server/.env`(프로젝트 루트 `.env`)에 보관합니다(깃허브 제외). 목록은 `.env.example` 참고.

| 연동 | 용도 | .env 키 | 비고 |
|------|------|---------|------|
| 노션 | 매출 데이터 | `NOTION_TOKEN`, `NOTION_SALES_DB_ID` | 공식 API |
| 코밴(CATECA) | 거래건수·무실적 | `KOVAN_ID/PW/AGENCY/TRAN` | Playwright 로그인 |
| 다우데이타(DDWM) | 거래건수·무실적·작년매출 | `DDWM_ID/PW` | 로그인+**이메일 2차인증**(Gmail 자동 읽기) |
| Gmail(IMAP) | 2차 인증번호 자동 읽기 | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Google 앱 비밀번호 |
| 국세청(data.go.kr) | 사업자 폐업여부 | `NTS_API_KEY` | 공공데이터포털 |
| 채널톡(Channel.io) | CS 현황·인입 | `CHANNELTALK_ACCESS_KEY/SECRET` | Open API |
| Anthropic(Claude) | 꿀팁 AI 초안 | `ANTHROPIC_API_KEY` | AI 생성 |

> ⚠️ 프로토타입 중 일부 키가 대화에 노출되었습니다. **운영 전환 시 모든 키를 재발급(rotate)** 하세요.

---

## 6. 프로젝트 구조

```
dashboard/
├─ src/                          # 화면(프론트엔드)
│  ├─ App.tsx                    # 전체 레이아웃 + 메뉴 라우팅
│  ├─ components/                # 화면 조각들
│  │  ├─ SalesMetrics.tsx        # 경영 지표
│  │  ├─ TrMetrics.tsx           # 거래(TR) 현황
│  │  ├─ InactiveStores.tsx      # 무실적 가맹점
│  │  ├─ CsStatus.tsx            # CS 담당자 현황
│  │  ├─ CallHeatmap.tsx         # 전화·채팅 인입 히트맵
│  │  └─ Playbooks.tsx           # 꿀팁게시판
│  └─ lib/                       # 데이터 가져오는 함수들
├─ server/                       # 중계 서버 + 수집기
│  ├─ notion-sales-bff.mjs       # ★ 메인 BFF 서버 (모든 /api)
│  ├─ kovan-tr-scraper.mjs       # 코밴 거래건수 수집
│  ├─ kovan-inactive-scraper.mjs # 코밴 무실적 수집
│  ├─ ddwm-*-scraper.mjs         # 다우데이타 수집기들
│  ├─ daily-collect.mjs          # 매일 실행: 수집기 일괄 실행
│  ├─ register-tr-task.ps1       # 윈도우 작업 스케줄러 등록
│  ├─ lib/                       # 로그인·이메일 등 공용 모듈
│  └─ data/                      # 수집된 데이터(JSON) — 깃 제외
├─ .env                          # 비밀키 — 깃 제외
├─ .env.example                  # 키 목록(값 없음)
├─ README.md                     # ← 이 문서(마스터)
└─ HOSTING.md                    # 운영 서버 가이드
```

---

## 7. 실행 방법 (개발용)

```bash
npm install                       # 의존성 설치(최초 1회)
npx playwright install chromium   # 스크래퍼용 브라우저(최초 1회)

node server/notion-sales-bff.mjs  # 중계 서버 (터미널 1) → http://localhost:8787
npm run dev                       # 화면 개발 서버 (터미널 2) → http://localhost:5173

node server/daily-collect.mjs     # (선택) 수집 한 번 실행
```

브라우저에서 **http://localhost:5173** 접속. (`.env`에 키가 있어야 실데이터가 보입니다.)
배포용 빌드: `npm run build` → `dist/` 정적 파일 생성.

---

## 8. 자동 수집(스케줄)

- 현재: **윈도우 작업 스케줄러** `KOVAN-TR-Daily` 가 매일 08:00에 `daily-collect.mjs` 실행(이 PC가 켜져 있어야 함).
- 운영 서버 이전 후: **Linux cron** 으로 전환 ([HOSTING.md](HOSTING.md) 참고).

---

## 9. 앞으로 제대로 알기 위해 배워야 할 것 (학습 로드맵)

지금까지는 "원하는 것"을 말로 했고 구현은 자동화로 진행됐습니다. 직접 이해·관리하려면 아래 순서를 권합니다.

1. **웹의 기본** — HTML/CSS/JavaScript, 브라우저가 화면을 그리는 원리
2. **React + TypeScript** — 컴포넌트·상태(state)·props 개념(공식 튜토리얼)
3. **HTTP / REST API** — "프론트가 서버에 요청하고 JSON을 응답받는다"
4. **Node.js / Express** — 서버가 API를 제공하는 방식
5. **Git / GitHub** — 코드 이력 관리·협업 (아래 11번)
6. **리눅스 서버 기초** — SSH 접속, 파일·프로세스, cron
7. **환경변수·비밀관리** — `.env`, 키 재발급, 권한
8. **데이터베이스 기초** — 지금은 JSON 파일, 커지면 PostgreSQL 등으로 이전
9. **(심화) 스크래핑·API의 한계** — 외부 사이트가 바뀌면 수집기도 고쳐야 함(유지보수)

> 한 번에 다 배울 필요는 없습니다. 운영에는 1·3·5·6번부터면 대부분 관리 가능합니다.

---

## 10. 보안 주의사항 (중요)

- `.env`(모든 비밀키)와 `server/data/*.json`(사업자번호·연락처 등 실데이터)은 **깃허브에 올라가지 않도록** 설정돼 있습니다(`.gitignore`).
- GitHub 저장소는 반드시 **Private(비공개)** 로.
- 프로토타입 중 노출된 키는 **운영 전 모두 재발급**.
- 외부 시스템은 **본인 회사 데이터·계정** 범위에서만 사용.

---

## 11. GitHub 업로드 방법

> 사전 준비: GitHub 계정, Git 설치(완료). 저장소는 **Private** 권장.

### A. 처음 한 번
```bash
cd d:/erp/dashboard

git init
git add .
git status          # ← 목록에 .env, server/data/*.json 이 '없어야' 정상
git commit -m "최초 커밋: ERP 통합 대시보드 프로토타입"
```

GitHub에 빈 저장소를 만들고 연결:

**웹사이트 방법:** github.com → **+** → New repository → 이름(예 `dain-erp-dashboard`) + **Private** → Create → 안내된 명령 실행:
```bash
git remote add origin https://github.com/<내계정>/dain-erp-dashboard.git
git branch -M main
git push -u origin main
```

**gh CLI 방법(설치 시):**
```bash
gh repo create dain-erp-dashboard --private --source . --remote origin --push
```

### B. 이후 변경할 때마다
```bash
git add .
git commit -m "무엇을 바꿨는지 한 줄"
git push
```

### ⚠️ 올리기 전 반드시
`git status` 결과에 **`.env` 가 없는지** 확인(비밀키 유출 방지). 실수로 올라갔다면 즉시 **모든 키 재발급** + 저장소에서 삭제.

---

운영(외부 서버) 업체·비용·배포는 **[HOSTING.md](HOSTING.md)** 참고.
