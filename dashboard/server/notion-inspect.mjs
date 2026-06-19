// 노션 자동 분석기 — 토큰만 있으면 됩니다. (Notion API 2025-09-03 / data source 모델)
//
// 통합(integration)에 연결된 모든 노션 데이터소스를 찾아서:
//   - DB(데이터소스) 이름과 ID
//   - 각 DB의 속성(컬럼) 이름과 타입
//   - "매출 DB로 보이는 것"과 날짜/금액 속성 추천
// 을 출력합니다. 여기서 나온 값을 .env 에 넣으면 됩니다.
//
// 사용법:
//   1) npm i dotenv @notionhq/client
//   2) .env 에 NOTION_TOKEN 만 넣기
//   3) node server/notion-inspect.mjs

import "dotenv/config";
import { Client } from "@notionhq/client";

const { NOTION_TOKEN } = process.env;
if (!NOTION_TOKEN) {
  console.error("❌ .env 에 NOTION_TOKEN 을 넣어주세요. (https://www.notion.so/my-integrations)");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

const nameOf = (ds) =>
  (ds.name ?? ds.title ?? []).map((t) => t.plain_text).join("") || "(제목 없음)";

const AMOUNT_HINTS = ["매출", "금액", "수익", "판매", "amount", "revenue", "sales", "price"];

function guessProps(properties) {
  const entries = Object.entries(properties);
  const dateProps = entries.filter(([, p]) => p.type === "date");
  const numberProps = entries.filter(([, p]) => p.type === "number");
  const pickAmount =
    numberProps.find(([name]) =>
      AMOUNT_HINTS.some((h) => name.toLowerCase().includes(h.toLowerCase()))
    ) ?? numberProps[0];
  return { date: dateProps[0]?.[0], amount: pickAmount?.[0], hasNumber: numberProps.length > 0 };
}

async function main() {
  console.log("🔎 노션 통합에 연결된 데이터소스를 검색 중…\n");

  const sources = [];
  let cursor;
  do {
    const res = await notion.search({
      filter: { property: "object", value: "data_source" },
      start_cursor: cursor,
      page_size: 100,
    });
    sources.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  if (sources.length === 0) {
    console.log("⚠️  접근 가능한 데이터소스가 없습니다.");
    console.log("   → 노션에서 매출 DB 페이지 [···] → '연결 추가'로 이 통합을 연결했는지 확인하세요.\n");
    return;
  }

  console.log(`총 ${sources.length}개 발견.\n`);

  const salesCandidates = [];

  for (const ds of sources) {
    const name = nameOf(ds);
    const g = guessProps(ds.properties ?? {});
    const looksLikeSales = g.date && g.amount;

    console.log("─".repeat(64));
    console.log(`📊 ${name}`);
    console.log(`   id: ${ds.id}`);
    const props = Object.entries(ds.properties ?? {})
      .map(([n, p]) => `${n}(${p.type})`)
      .join(", ");
    console.log(`   속성: ${props}`);
    if (looksLikeSales) {
      console.log(`   ✅ 매출 DB 후보 → 날짜="${g.date}", 금액="${g.amount}"`);
      salesCandidates.push({ name, id: ds.id, date: g.date, amount: g.amount });
    }
    console.log("");
  }

  console.log("═".repeat(64));
  if (salesCandidates.length === 0) {
    console.log("매출 DB로 단정할 후보(날짜+숫자 속성)가 없습니다.");
    console.log("위 목록에서 매출 DB를 직접 골라 .env 에 id/속성명을 넣어주세요.");
  } else {
    console.log("💡 매출 DB 후보 — .env 에 아래처럼 넣으세요:");
    for (const c of salesCandidates) {
      console.log(`\n   # ${c.name}`);
      console.log(`   NOTION_SALES_DB_ID=${c.id}`);
      console.log(`   NOTION_DATE_PROP=${c.date}`);
      console.log(`   NOTION_AMOUNT_PROP=${c.amount}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("❌ 오류:", e?.body ?? e?.message ?? e);
  process.exit(1);
});
