# 노션 매출 데이터 연동 가이드

대시보드의 **매출 지표**는 지금 목업 데이터로 동작합니다.
아래 절차대로 하면 실제 노션 매출 DB 데이터로 전환됩니다.

> ⚠️ 노션 API 키는 **브라우저(React)에 직접 넣으면 안 됩니다.**
> 작은 백엔드(BFF)가 키를 보관하고 노션을 대신 조회합니다. (master.md §5.5)

## 직접 해야 하는 건 "토큰 발급" 하나뿐입니다

DB ID와 속성(날짜·금액) 이름은 **몰라도 됩니다.** 토큰만 있으면 분석 스크립트가 찾아줍니다.

### 1) 노션 통합 토큰 발급 (직접)

1. https://www.notion.so/my-integrations 접속 → **New integration** 생성
2. 만든 통합의 **시크릿 토큰**(`secret_...` 또는 `ntn_...`) 복사
3. 매출 데이터가 있는 노션 페이지/DB → 우상단 `···` → **연결(Connections) 추가** → 위 통합 선택
   - 이 단계를 안 하면 통합이 DB를 못 봅니다.

### 2) 토큰 넣고 분석 실행 (자동)

```bash
npm i express cors dotenv @notionhq/client   # 최초 1회
cp .env.example .env
#   → .env 의 NOTION_TOKEN 에 복사한 토큰만 붙여넣기 (나머지는 비워둬도 됨)

node server/notion-inspect.mjs
```

출력 예시:

```
📊 DB: 2026 매출관리
   NOTION_SALES_DB_ID=2f1a...e9
   속성:
     - 거래일  (date)
     - 매출액  (number)
   ✅ 매출 DB로 보입니다. 추천 설정:
        NOTION_DATE_PROP=거래일
        NOTION_AMOUNT_PROP=매출액
```

→ 여기 나온 `NOTION_SALES_DB_ID` 만 `.env` 에 복사하면 됩니다.
   (속성명은 비워둬도 BFF가 타입을 보고 자동으로 찾습니다. 자동 감지가 틀리면 위 추천값을 넣으세요.)

### 3) 실제 데이터로 전환

```bash
# BFF 실행 (새 터미널)
node server/notion-sales-bff.mjs

# 프론트를 실제 데이터로 전환: src/lib/sales.ts 의  USE_MOCK = true → false

# dev 서버 실행
npm run dev
```

Vite dev 서버는 `/api` 요청을 BFF(`http://localhost:8787`)로 프록시합니다(`vite.config.ts`).

## 데이터 형태 (참고)

BFF의 `/api/sales` 가 반환하는 형태:

```json
[
  { "date": "2026-06-17", "amount": 2150000 },
  { "date": "2026-06-16", "amount": 1980000 }
]
```

지표(금일/월간/월평균/년간, 전년 동기간 비교)는 이 일자별 데이터로 프론트에서 자동 계산됩니다.
