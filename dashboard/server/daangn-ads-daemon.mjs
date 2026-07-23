// 당근 광고 상주 수집 데몬 — 로그인된 브라우저를 켜둔 채 주기적으로 광고 지표를 DOM에서 추출.
//  · 최초 1회 로그인(창에서 직접) → 이후 브라우저를 안 끄고 살려둠(세션 유지) → N분마다 갱신.
//  · 세션 만료/브라우저 종료 시 재실행+재로그인 필요(당근 제약).
// 저장: server/data/daangn-ads.json  (BFF /api/daangn-ads 가 제공)
import "dotenv/config";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { pushToServer, serverFetch } from "./lib/push-to-server.mjs";
import { saveCash } from "./lib/daangn-cash.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, "data", "daangn-profile");
const OUT = join(__dirname, "data", "daangn-ads.json");
const CASH_OUT = join(__dirname, "data", "daangn-cash.json");
const DBG = join(__dirname, "data", "_daangn-dom.txt");
const ADVERTISER = process.env.DAANGN_ADVERTISER_ID || "3794527";
const ADS = `https://ads-lite.business.daangn.com/advertisements/?advertiserId=${ADVERTISER}&advertiser_id=${ADVERTISER}`;
const REFRESH_MS = 30 * 60 * 1000; // 30분
const num = (s) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;

const ctrOf = (clicks, impressions) => (impressions ? +((clicks / impressions) * 100).toFixed(2) : 0);

// 그룹 블록 안의 소재(개별 광고) 목록.
//   "전체 N ⸱ 광고중 M" 뒤부터 "이 그룹에 광고 추가" 전까지가 소재 영역.
//   목록 페이지에는 소재별로 클릭률만 나온다(노출·클릭·지출은 그룹 상세에만 있음).
function parseCreatives(block) {
  const zone = block.match(/전체\s*\d+[^\d]*?광고중\s*\d+\s*(.*?)(?:이 그룹에 광고 추가|그룹 상세|$)/);
  if (!zone) return [];
  const out = [];
  const re = /(.+?)\s*광고(중|꺼짐)(?:[^\d%]*클릭률\s*([\d.]+)\s*%)?/g;
  let m;
  while ((m = re.exec(zone[1])) && out.length < 30) {
    const name = m[1].replace(/[⸱·・]/g, "").trim();
    if (!name) continue;
    out.push({
      name,
      status: m[2] === "중" ? "ON" : "OFF",
      ctr: m[3] === undefined ? null : Number(m[3]),
    });
  }
  return out;
}

// 그룹 상세 페이지의 소재 목록 — 여기엔 노출·클릭·클릭률·지출이 다 있다.
//   "광고중 {소재명} {게재위치} 노출수 N 클릭수 N 클릭률 N% 지출 N원 ON"
//   클릭률은 노출이 0이면 빠질 수 있으므로 선택적으로 두고 직접 계산한다.
// 소재명 뒤에 붙는 게재위치 라벨. "비즈프로필 소식"처럼 두 단어인 것도 있다.
const PLACEMENTS =
  /\s+(웹사이트|비즈프로필(?:\s*소식)?|소식|당근채팅|채팅|전화(?:\s*걸기)?|앱\s*설치|외부\s*링크|피드|당근마켓|가게\s*홍보)$/;

function parseCreativeDetail(text) {
  const out = [];
  // 이름 부분에 머리말 토큰(광고중/성과/노출수…)이 끼면 안 된다.
  // 그냥 (.+?) 로 두면 페이지 상단 그룹 상태의 "광고중"에 먼저 걸려
  // 헤더 전체가 소재명으로 딸려온다.
  const re =
    /광고(중|꺼짐)\s+((?:(?!광고중|광고꺼짐|노출수|성과|광고 목록).){2,80}?)\s*노출수\s*([\d,]+)\s*클릭수\s*([\d,]+)\s*(?:클릭률\s*([\d.]+)\s*%\s*)?지출\s*([\d,]+)\s*원/g;
  let m;
  while ((m = re.exec(text)) && out.length < 30) {
    const impressions = num(m[3]);
    const clicks = num(m[4]);
    out.push({
      name: m[2].replace(PLACEMENTS, "").trim(),
      status: m[1] === "중" ? "ON" : "OFF",
      impressions,
      clicks,
      spend: num(m[6]),
      // 당근이 표시하는 클릭률을 그대로 쓰고(화면과 일치), 없으면 계산
      ctr: m[5] === undefined ? ctrOf(clicks, impressions) : Number(m[5]),
    });
  }
  return out;
}

function parseAds(text) {
  const cashM = text.match(/광고캐시\s*([\d,]+)\s*원/);
  const cash = cashM ? num(cashM[1]) : null;

  // 1) 광고 그룹의 시작 지점을 모두 찾는다. (유형 + 상태 + 그룹명#N)
  const head = /(디스플레이|검색)\s*광고(?:중|꺼짐)\s*(ON|OFF)\s*([^#]{2,40}?)\s*#\d+/g;
  const heads = [];
  let h;
  while ((h = head.exec(text)) && heads.length < 30) {
    heads.push({ type: h[1], status: h[2], name: h[3].trim(), at: h.index, end: head.lastIndex });
  }

  // 2) 그룹마다 다음 그룹 직전까지를 한 덩어리로 잘라 개별 파싱한다.
  //    한 정규식으로 전부 훑으면, 값이 빠진 그룹(예: 노출 0이라 클릭률 줄이 없음)에서
  //    다음 그룹 숫자를 끌어와 매칭되거나 아예 통째로 누락된다.
  const ads = heads.map((g, i) => {
    const block = text.slice(g.end, i + 1 < heads.length ? heads[i + 1].at : text.length);
    const pick = (re) => { const m = block.match(re); return m ? num(m[1]) : 0; };
    const impressions = pick(/노출수\s*([\d,]+)/);
    const clicks = pick(/클릭수\s*([\d,]+)/);
    return {
      type: g.type,
      status: g.status,
      name: g.name,
      dailyBudget: pick(/하루예산\s*([\d,]+)\s*원/),
      impressions,
      clicks,
      spend: pick(/지출\s*([\d,]+)\s*원/),
      ctr: ctrOf(clicks, impressions), // 소재 클릭률을 갖다 쓰지 않고 직접 계산
      creatives: parseCreatives(block),
    };
  });

  const tot = ads.reduce(
    (a, x) => ({ impressions: a.impressions + x.impressions, clicks: a.clicks + x.clicks, spend: a.spend + x.spend }),
    { impressions: 0, clicks: 0, spend: 0 }
  );
  const periodM = text.match(/(최근 7일|어제|오늘)\s*성과/);
  return { cash, period: periodM ? periodM[1] : "최근 7일", ads, total: { ...tot, ctr: ctrOf(tot.clicks, tot.impressions) } };
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1360, height: 950 }, ignoreHTTPSErrors: true });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  // 창 상태 제어(CDP): 로그인돼 있으면 최소화, 로그인 필요할 때만 보이게.
  const cdp = await ctx.newCDPSession(page).catch(() => null);
  const winState = async (state) => {
    if (!cdp) return;
    try {
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: state } });
    } catch {}
  };

  // 로그인 확인/대기
  await page.goto(ADS, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (/\/login/.test(page.url())) {
    await winState("normal"); // 로그인 필요 → 창 보이게
    console.log("\n▶ 열린 창에서 당근 비즈니스에 로그인해주세요. 로그인되면 자동으로 최소화되고 백그라운드로 수집합니다.\n");
    for (let i = 0; i < 300; i++) { await page.waitForTimeout(2000); if (!/\/login|nid\.|google|kakao|naver/.test(page.url())) break; }
  }
  await winState("minimized"); // 로그인됨 → 바로 최소화

  async function collect() {
    try {
      await page.goto(ADS, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(6000);
      if (/\/login/.test(page.url())) { await winState("normal"); console.log("⚠️ 세션 만료 — 창에서 다시 로그인 필요"); const lo = { updatedAt: new Date().toISOString(), error: "세션 만료 — 재로그인 필요", loggedOut: true }; writeFileSync(OUT, JSON.stringify(lo, null, 2)); await pushToServer("/api/daangn-ads", lo); return; }
      const text = await page.evaluate(() => document.body.innerText);
      writeFileSync(DBG, text);
      const data = parseAds(text.replace(/\s+/g, " "));

      // 목록 페이지에는 소재별 클릭률만 있다. 노출·클릭·지출까지 받으려면
      // 그룹 상세로 들어가야 한다. 목록의 그룹 링크(/ad-groups/...)가 상세 주소다.
      const groupLinks = await page.$$eval("a[href*='/ad-groups/']", (as) => [...new Set(as.map((a) => a.href))]);
      for (let i = 0; i < data.ads.length && i < groupLinks.length; i++) {
        try {
          await page.goto(groupLinks[i], { waitUntil: "networkidle", timeout: 45000 });
          await page.waitForTimeout(3500);
          const dt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
          const detailed = parseCreativeDetail(dt);
          if (detailed.length) data.ads[i].creatives = detailed;
        } catch (e) {
          console.log(`  상세 수집 실패(${data.ads[i].name}):`, e.message);
        }
      }

      const payload = { updatedAt: new Date().toISOString(), advertiserId: ADVERTISER, ...data };
      writeFileSync(OUT, JSON.stringify(payload, null, 2));
      console.log(`[${new Date().toLocaleTimeString()}] 수집: 광고 ${data.ads.length}건 · 캐시 ${data.cash?.toLocaleString()}원 · 노출 ${data.total.impressions} 클릭 ${data.total.clicks} 지출 ${data.total.spend}`);
      await pushToServer("/api/daangn-ads", payload);
      // 광고캐시 내역(/finances)도 같은 세션에서 이어서 수집(베스트에포트).
      await saveCash(page, ADVERTISER, CASH_OUT);
      await winState("minimized"); // 수집 후 다시 최소화
    } catch (e) { console.log("수집 오류:", e.message); }
  }

  await collect();
  setInterval(collect, REFRESH_MS);

  // 서버 원격 트리거 폴링 — 서버 대시보드에서 '데이터 동기화'(마케팅) 누르면 즉시 수집.
  const POLL_MS = 30000;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const r = await serverFetch("/api/marketing-trigger");
    if (!r || !r.ok) return;
    let j; try { j = await r.json(); } catch { return; }
    if (!j.pending) return;
    busy = true;
    try {
      console.log(`[${new Date().toLocaleTimeString()}] ▶ 서버 수집 요청 감지 — 당근+네이버 수집`);
      await serverFetch("/api/marketing-trigger/ack", { method: "POST" }); // 중복 방지 위해 먼저 클리어
      await collect();       // 당근 즉시 수집
      runNaverOnce();        // 네이버도 백그라운드 수집
    } catch (e) { console.log("트리거 처리 오류:", e.message); }
    finally { busy = false; }
  }, POLL_MS);

  console.log(`\n✅ 상주 수집 시작 — ${REFRESH_MS / 60000}분마다 갱신 + 서버 요청 폴링(${POLL_MS / 1000}s). 이 창을 켜두세요.`);
}

// 네이버 블로그 수집 1회(백그라운드, 콘솔 없음)
function runNaverOnce() {
  try {
    const child = spawn(process.execPath, [join(__dirname, "naver-blog-scraper.mjs")], {
      cwd: join(__dirname, ".."),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (e) { console.log("네이버 실행 오류:", e.message); }
}

// 파서만 따로 테스트할 수 있도록 내보낸다(직접 실행할 때만 데몬이 뜬다).
export { parseAds, parseCreatives, parseCreativeDetail };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("❌", e.message); process.exit(1); });
}
