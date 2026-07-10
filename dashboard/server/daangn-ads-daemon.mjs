// 당근 광고 상주 수집 데몬 — 로그인된 브라우저를 켜둔 채 주기적으로 광고 지표를 DOM에서 추출.
//  · 최초 1회 로그인(창에서 직접) → 이후 브라우저를 안 끄고 살려둠(세션 유지) → N분마다 갱신.
//  · 세션 만료/브라우저 종료 시 재실행+재로그인 필요(당근 제약).
// 저장: server/data/daangn-ads.json  (BFF /api/daangn-ads 가 제공)
import "dotenv/config";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { pushToServer, serverFetch } from "./lib/push-to-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, "data", "daangn-profile");
const OUT = join(__dirname, "data", "daangn-ads.json");
const DBG = join(__dirname, "data", "_daangn-dom.txt");
const ADVERTISER = process.env.DAANGN_ADVERTISER_ID || "3794527";
const ADS = `https://ads-lite.business.daangn.com/advertisements/?advertiserId=${ADVERTISER}&advertiser_id=${ADVERTISER}`;
const REFRESH_MS = 30 * 60 * 1000; // 30분
const num = (s) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;

function parseAds(text) {
  const cashM = text.match(/광고캐시\s*([\d,]+)\s*원/);
  const cash = cashM ? num(cashM[1]) : null;
  const ads = [];
  // 광고 블록: 유형 → ... → 노출수 → 클릭수 → 지출 → (그룹명) → 클릭률
  const re = /(디스플레이|검색)\s*광고[중]?\s*(ON|OFF)?[\s\S]{0,60}?([^\n#]{2,40}?)\s*#\d+[\s\S]*?하루예산\s*([\d,]+)\s*원[\s\S]*?노출수\s*([\d,]+)[\s\S]*?클릭수\s*([\d,]+)[\s\S]*?지출\s*([\d,]+)\s*원[\s\S]*?클릭률\s*([\d.]+)\s*%/g;
  let m;
  while ((m = re.exec(text)) && ads.length < 30) {
    ads.push({ type: m[1], status: m[2] || "", name: m[3].trim(), dailyBudget: num(m[4]), impressions: num(m[5]), clicks: num(m[6]), spend: num(m[7]), ctr: Number(m[8]) });
  }
  const tot = ads.reduce((a, x) => ({ impressions: a.impressions + x.impressions, clicks: a.clicks + x.clicks, spend: a.spend + x.spend }), { impressions: 0, clicks: 0, spend: 0 });
  const periodM = text.match(/(최근 7일|어제|오늘)\s*성과/);
  return { cash, period: periodM ? periodM[1] : "최근 7일", ads, total: { ...tot, ctr: tot.impressions ? +(tot.clicks / tot.impressions * 100).toFixed(2) : 0 } };
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
      const payload = { updatedAt: new Date().toISOString(), advertiserId: ADVERTISER, ...data };
      writeFileSync(OUT, JSON.stringify(payload, null, 2));
      console.log(`[${new Date().toLocaleTimeString()}] 수집: 광고 ${data.ads.length}건 · 캐시 ${data.cash?.toLocaleString()}원 · 노출 ${data.total.impressions} 클릭 ${data.total.clicks} 지출 ${data.total.spend}`);
      await pushToServer("/api/daangn-ads", payload);
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

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
