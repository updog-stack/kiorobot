# 다인아이앤씨 통합 대시보드 (ERP)

> 노션 · VAN사 · 채널톡 · 국세청에 흩어진 사내 데이터를 **한 화면에서 실시간으로 보는 통합 대시보드**
> 현재 버전: **v0.1 (프로토타입)**

---

## 이 프로젝트는 무엇이고, 왜 만들었나

회사의 데이터는 여러 시스템에 흩어져 있습니다 — 매출은 노션, 거래 건수는 VAN사(코밴·다우데이타), 고객 상담은 채널톡, 폐업 조회는 국세청.
필요한 숫자를 보려면 매번 각 사이트에 따로 로그인해 확인해야 했습니다.

이 대시보드는 그 데이터를 **자동으로 모아 한 화면에서 실시간으로 보여줍니다.**
대표·팀장·직원이 각자 필요한 지표(매출·거래·고객·가맹점 현황)를 한눈에 파악하고 의사결정하는 것이 목표입니다.

---

## v0.1에서 할 수 있는 것

| 메뉴 | 구현 내용 | 데이터 출처 |
|------|-----------|-------------|
| **경영 지표** | 금일 / 월간 / 월평균 / 년간 매출, 전년 동기 대비 성장률, 월별 매출 차트(올해 vs 작년) | 노션 매출 DB(장비매출 · 할부/렌탈) |
| **거래(TR) 현황** | VAN사별(코밴 · 다우데이타) 월별 거래 건수 + 합산, 추이 차트, 수동 동기화 | 코밴 CATECA · 다우데이타 DDWM 자동수집 |
| **무실적 가맹점** | 거래 없는 가맹점 목록(매장명 · 사업자번호 · 작년매출 · 연락처), **국세청 폐업여부 자동 조회**, 검색 | 코밴 · 다우데이타 + 국세청 API |
| **CS 현황** | 담당자별 실시간 상태(채널톡), 일일 처리/대기 건수, 상담 매장 목록, **전화 · 채팅 인입 히트맵(요일 × 시간)** | 채널톡 Open API |
| **꿀팁게시판** | 상담원이 선택지를 따라가며 응대하는 **가이드 Q&A(의사결정 트리)**, **Claude AI 응대 초안 생성** | 수동 작성 + 채널톡 이력 + Claude AI |

> `전체 현황` · `일정` · `업무/할 일` 탭은 v0.1에서는 자리만 잡혀 있으며 다음 버전에서 구현 예정입니다. (→ [로드맵](#로드맵))

---

## 빠른 시작 (다른 PC에서 실행하기)

#### 1. 준비물
- **Node.js LTS** — https://nodejs.org 에서 설치 (한 번만)

#### 2. 내려받기 & 설치
```bash
git clone https://github.com/updog-stack/kiorobot.git
cd kiorobot/dashboard
npm install            # 최초 1회 (필요한 패키지 자동 설치)
```

#### 3. 실행 (터미널 2개)
```bash
npm run dev                          # ① 화면      → http://localhost:5173
node server/notion-sales-bff.mjs     # ② 중계 서버  → http://localhost:8787
```
브라우저에서 **http://localhost:5173** 접속.

> 💡 윈도우에서는 `dashboard/실행.bat` 더블클릭으로 ①②를 한 번에 띄울 수 있습니다.

#### 4. 환경 설정 (API 연동)
화면은 바로 뜨지만, **실제 데이터(매출·거래·CS 등)는 API 키가 있어야** 표시됩니다.
`dashboard/.env.example` 을 복사해 `dashboard/.env` 를 만들고 값을 채우세요.

```bash
cp dashboard/.env.example dashboard/.env   # 그리고 .env 안의 값들을 입력
```

| 키 | 용도 |
|----|------|
| `NOTION_TOKEN` | 노션 매출 DB 조회 |
| `KOVAN_ID` / `KOVAN_PW` | 코밴 거래/무실적 자동수집 로그인 |
| `DDWM_ID` / `DDWM_PW` | 다우데이타 자동수집 로그인 |
| `CHANNELTALK_ACCESS_KEY` / `_SECRET` | 채널톡 CS 현황 |
| `NTS_API_KEY` | 국세청 폐업여부 조회 |
| `ANTHROPIC_API_KEY` | 꿀팁게시판 AI 초안 생성 |

> ⚠️ `.env` 는 **비밀번호·API 키가 들어있어 절대 깃허브에 올리지 않습니다.** (`.gitignore`로 제외됨)

---

## 프로젝트 구조 (유지보수용)

```
erp/
├─ README.md                 ← (이 파일) 프로젝트 개요
├─ master.md                 ← 비전 · 기획 문서
└─ dashboard/                ← 실제 대시보드 앱
   ├─ src/                   프론트엔드 (React + TypeScript)
   │  ├─ App.tsx             탭 구성 · 화면 라우팅
   │  ├─ components/         화면 컴포넌트 (탭별 UI)
   │  └─ lib/                데이터 로직 (API 호출 · 가공)
   ├─ server/
   │  ├─ notion-sales-bff.mjs  중계 서버(BFF) — 모든 /api/* 처리
   │  ├─ *-scraper.mjs         VAN사 자동수집 스크래퍼
   │  └─ data/                 수집된 데이터(.json, git 제외)
   ├─ .env.example          환경변수 견본
   ├─ README.md             대시보드 상세 문서
   └─ HOSTING.md            운영 서버 배포 가이드
```

### 동작 원리 — 왜 "중계 서버(BFF)"가 있나
노션 · 채널톡 등의 **API 키는 브라우저에 직접 넣으면 안 됩니다**(누구나 볼 수 있게 됨).
그래서 화면과 외부 서비스 사이에 작은 서버(**BFF, Backend-for-Frontend**)를 두고 키는 **서버만** 보관합니다.

```
[화면]  →  /api/... 호출  →  [중계 서버(BFF)]  →  키로 외부 API 호출  →  가공해 화면에 전달
 React                         Node + Express        노션·채널톡·국세청 등
```

### 기술 스택
| 구분 | 도구 |
|------|------|
| 화면 | React · TypeScript · Vite |
| 중계 서버 | Node.js · Express |
| 자동 수집 | Playwright(자동 로그인·스크래핑) · imapflow(2차 인증 메일 읽기) · xlsx(엑셀 파싱) |
| 외부 연동 | 노션 · 채널톡 · 국세청 · Claude(AI) API |

---

## 로드맵

다음 버전에서 구현 예정:
- **전체 현황** — 핵심 운영지표 한눈 요약 대시보드
- **일정** — 구글캘린더 연동
- **경영지표 고도화** — 작년 대비 성과 점수화 · 연말 예상
- **업무 / 할 일** 관리

---

## 문의
- 담당: kdm@daininc.kr
- 상세 문서: [`dashboard/README.md`](dashboard/README.md) · 배포 가이드: [`dashboard/HOSTING.md`](dashboard/HOSTING.md)
