// 당근 광고캐시 내역(/finances = "광고캐시 내역") 수집.
//   · 광고 수집과 '같은 브라우저·세션'에서 이어서 호출한다(창·세션을 두 번 열지 않기 위해).
//     daangn-ads-once(서버 1회) / daangn-ads-daemon(로컬 상주) 둘 다 이 함수를 import 해서 쓴다.
//   · 데이터는 UI DOM 대신 GraphQL(ads-bff) 응답을 가로채 구조화된 채로 모은다 → 화면 포맷 변화에 안 흔들림.
//   · '전체' 탭 + 무한스크롤로 계정 개설 이후 전체 내역을 끌어온다.
//
// 거래 노드 예: { id, updatedAt, title:"광고캐시 사용", type:"CHARGED_AD", description:"광고 집행", amount:{value:14222} }
//   · CHARGED_AD = 광고 집행으로 캐시 사용(차감, -)  ·  CHARGE_GIFT = 무상캐시 충전(+)

import { readFileSync, writeFileSync } from "node:fs";
import { pushToServer } from "./push-to-server.mjs";

const FIN = (adv) =>
  `https://ads-lite.business.daangn.com/finances/?advertiserId=${adv}&advertiser_id=${adv}`;

// 거래 부호: 충전(+1) / 사용·환불(-1). 한글 제목·내용을 1순위, 영문 타입을 폴백으로.
export function cashDirection(type = "", title = "", description = "") {
  const s = `${title} ${description}`;
  if (/충전|적립|지급|캐시백|보너스|환급/.test(s)) return 1;
  if (/사용|환불|차감|소멸|취소|회수/.test(s)) return -1;
  if (/^CHARGE_/.test(type)) return 1; // CHARGE_GIFT, CHARGE_PREPAID …
  if (/^CHARGED_/.test(type)) return -1; // CHARGED_AD …
  return -1; // 알 수 없으면 보수적으로 '사용'
}

// ISO(UTC) → 한국 날짜(YYYY-MM-DD). 당근 화면 표기가 KST 기준이라 집계도 KST로 맞춘다.
export function kstDate(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 파싱된 JSON 트리에서 거래 노드(__typename === "Transaction")를 모두 긁는다(쿼리 모양에 안 흔들림).
function walkTransactions(obj, byId) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) { for (const x of obj) walkTransactions(x, byId); return; }
  if (obj.__typename === "Transaction" && obj.id && obj.amount && typeof obj.amount.value === "number") {
    const type = obj.type || "";
    const title = obj.title || "";
    const description = obj.description || "";
    const amount = Math.abs(obj.amount.value);
    const dir = cashDirection(type, title, description);
    byId.set(obj.id, {
      id: obj.id,
      ts: obj.updatedAt || null,
      date: obj.updatedAt ? kstDate(obj.updatedAt) : null,
      title, type, description,
      amount,               // 절대값(원)
      direction: dir,       // +1 충전 / -1 사용
      signed: dir * amount, // 부호 반영액(순증감 계산용)
    });
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") walkTransactions(v, byId);
  }
}

// transactions 연결의 pageInfo.hasNextPage 를 찾는다(더 불러올 페이지가 있는지).
function findTxPageInfo(obj) {
  let found = null;
  const walk = (o) => {
    if (!o || typeof o !== "object" || found !== null) return;
    if (o.edges && o.pageInfo && typeof o.pageInfo.hasNextPage === "boolean") {
      // 거래 목록 연결인지 확인(노드가 Transaction)
      const n = o.edges[0]?.node;
      if (!n || n.__typename === "Transaction") { found = o.pageInfo.hasNextPage; return; }
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(obj);
  return found;
}

// 잔액(유상/무상)을 담은 객체를 찾는다. prepaidCash=유상, freeCash=무상.
function findBalance(obj) {
  let found = null;
  const walk = (o) => {
    if (!o || typeof o !== "object" || found) return;
    if (o.prepaidCash && typeof o.prepaidCash.value === "number" &&
        o.freeCash && typeof o.freeCash.value === "number") {
      found = { paid: o.prepaidCash.value, free: o.freeCash.value };
      return;
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(obj);
  return found;
}

// 잔액 DOM 폴백("유상 캐시 201,082원" / "무상 캐시 0원").
async function readBalanceDom(page) {
  try {
    const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const paid = t.match(/유상\s*캐시\s*([\d,]+)\s*원/);
    const free = t.match(/무상\s*캐시\s*([\d,]+)\s*원/);
    if (!paid && !free) return null;
    const num = (m) => (m ? Number(m[1].replace(/[^0-9]/g, "")) : 0);
    return { paid: num(paid), free: num(free) };
  } catch { return null; }
}

// 이전 저장분과 새 수집분을 '거래 id 기준'으로 병합한다(누적).
//   · 같은 id 는 새 값으로 갱신(오늘자 '사용'은 하루 동안 누적 증가하므로 최신값이 맞다).
//   · 새 수집이 이번 달만 담아도 지난 달 내역은 그대로 보존된다.
//   · 수집 실패(loggedOut)면 거래는 건드리지 않고 상태만 얹는다.
export function mergeCash(existing, incoming) {
  const byId = new Map();
  for (const t of existing?.transactions || []) if (t?.id) byId.set(t.id, t);
  for (const t of incoming?.transactions || []) if (t?.id) byId.set(t.id, t); // 새 수집이 우선
  const transactions = [...byId.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return {
    updatedAt: incoming?.updatedAt || existing?.updatedAt || null,
    advertiserId: incoming?.advertiserId || existing?.advertiserId || null,
    balance: incoming?.balance || existing?.balance || null,
    transactions,
    ...(incoming?.loggedOut ? { loggedOut: true, error: incoming.error } : {}),
  };
}

// 이미 로그인된 page 로 /finances 를 열고 캐시 내역을 수집해 반환한다.
// 반환: { balance:{paid,free,total}|null, transactions:[...], loggedOut?:true }
export async function collectCash(page, advertiserId) {
  const byId = new Map();
  let balance = null;
  let hasNextPage = null; // transactions 연결의 마지막 pageInfo

  const onResp = async (res) => {
    try {
      if (!/graphql/i.test(res.url())) return;
      const ct = res.headers()["content-type"] || "";
      if (!/json/.test(ct)) return;
      const body = await res.text();
      if (!/"__typename":"Transaction"|prepaidCash/.test(body)) return;
      let j; try { j = JSON.parse(body); } catch { return; }
      walkTransactions(j, byId);
      const b = findBalance(j);
      if (b) balance = b;
      const pi = findTxPageInfo(j);
      if (pi !== null) hasNextPage = pi;
    } catch { /* 개별 응답 실패는 무시 */ }
  };

  page.on("response", onResp);
  try {
    await page.goto(FIN(advertiserId), { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(4500);
    if (/\/login/.test(page.url())) return { loggedOut: true };
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300); }

    // 기간 필터 기본값은 '이번 달'. '전체'(전체 기간)로 바꿔 과거 달까지 불러온다.
    //   세그먼트 컨트롤이라 getByText().click() 이 안 먹는 경우가 있어 좌표 클릭으로 확실히 누른다.
    //   ※ 그래도 안 바뀌어도 서버 저장이 id 기준 누적이라, 매달 '이번 달'만 담겨도 과거분은 보존된다.
    try {
      const box = await page.evaluate(() => {
        const el = [...document.querySelectorAll("button,[role=tab],[role=radio],div,span,li")]
          .find((e) => (e.textContent || "").trim() === "전체" && e.children.length <= 1);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (box) { await page.mouse.click(box.x, box.y); await page.waitForTimeout(2500); }
    } catch { /* 탭 없으면 기본값으로 진행 */ }

    // 거래 목록이 든 스크롤 컨테이너를 표시해 둔다(window 가 아니라 내부 div 가 스크롤됨).
    const tagScroller = () => page.evaluate(() => {
      document.querySelectorAll("[data-cash-scroller]").forEach((e) => e.removeAttribute("data-cash-scroller"));
      const c = [...document.querySelectorAll("*")]
        .filter((e) => e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 150)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (c) c.setAttribute("data-cash-scroller", "1");
    });
    await tagScroller();

    // 무한스크롤: 컨테이너를 점진적으로 내리며 다음 페이지를 유발. hasNextPage=false 확인되면 종료.
    let prev = -1, stable = 0;
    for (let i = 0; i < 200 && stable < 8; i++) {
      await page.evaluate(() => {
        const el = document.querySelector("[data-cash-scroller]");
        if (el) el.scrollTop = Math.min(el.scrollTop + Math.round(el.clientHeight * 0.75), el.scrollHeight);
        window.scrollBy(0, 600);
      });
      await page.waitForTimeout(650);
      if (byId.size === prev) stable++; else { stable = 0; prev = byId.size; }
      if (hasNextPage === false && stable >= 3) break; // 마지막 페이지 확인됨
      if (i % 12 === 11) await tagScroller(); // 새 컨텐츠로 컨테이너가 바뀌면 다시 잡기
    }

    if (!balance) balance = await readBalanceDom(page);
  } finally {
    page.off("response", onResp);
  }

  const transactions = [...byId.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  if (balance) balance.total = (balance.paid || 0) + (balance.free || 0);
  return { balance, transactions };
}

// 광고 수집 뒤 같은 page 로 호출: 캐시 내역 수집 → 로컬 파일에 누적 병합 저장 → 서버 업로드.
//   베스트에포트(예외를 삼킨다) — 캐시 수집이 실패해도 광고 수집 결과엔 영향이 없다.
export async function saveCash(page, advertiserId, outPath) {
  try {
    const cash = await collectCash(page, advertiserId);
    const incoming = { updatedAt: new Date().toISOString(), advertiserId, ...cash };
    let existing = null; try { existing = JSON.parse(readFileSync(outPath, "utf8")); } catch { /* 최초 수집 */ }
    const merged = mergeCash(existing, incoming);
    writeFileSync(outPath, JSON.stringify(merged, null, 2));
    await pushToServer("/api/daangn-cash", incoming); // 서버도 자체 병합(mergeCash)
    console.log(`✅ 당근 캐시: 거래 ${merged.transactions.length}건(누적) · 잔액 ${cash.balance?.total?.toLocaleString?.() ?? "?"}원`);
    return merged;
  } catch (e) {
    console.log("  캐시 내역 수집 실패(광고 수집은 정상):", e.message);
    return null;
  }
}
