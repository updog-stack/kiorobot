// 당근 광고 지표 1회 수집(서버용) — 이식된 storageState 로 로그인, DOM에서 지표 추출 후 종료.
//   · 서버(리눅스)는 Xvfb 가상화면 위에서 headless:false 로 실행: xvfb-run -a node server/daangn-ads-once.mjs
//   · 세션은 data/daangn-state.json (로컬에서 추출해 복사). 만료 시 로컬 재로그인→재추출→재복사.
//   · 로컬 상주 데몬(daangn-ads-daemon.mjs)과 동일한 파싱. 저장/업로드도 동일(daangn-ads.json · /api/daangn-ads).
import "dotenv/config";
import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pushToServer } from "./lib/push-to-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE = join(__dirname, "data", "daangn-state.json");
const OUT = join(__dirname, "data", "daangn-ads.json");
const ADVERTISER = process.env.DAANGN_ADVERTISER_ID || "3794527";
const ADS = `https://ads-lite.business.daangn.com/advertisements/?advertiserId=${ADVERTISER}&advertiser_id=${ADVERTISER}`;
const num = (s) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;

function parseAds(text) {
  const cashM = text.match(/광고캐시\s*([\d,]+)\s*원/);
  const cash = cashM ? num(cashM[1]) : null;
  const ads = [];
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
  if (!existsSync(STATE)) { console.error("❌ daangn-state.json 없음 — 로컬에서 세션 추출 후 복사 필요"); process.exit(1); }
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1360, height: 950 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  try {
    await page.goto(ADS, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(6000);
    if (/\/login/.test(page.url())) {
      const lo = { updatedAt: new Date().toISOString(), error: "세션 만료 — 재로그인 필요", loggedOut: true };
      writeFileSync(OUT, JSON.stringify(lo, null, 2));
      await pushToServer("/api/daangn-ads", lo);
      console.log("⚠️ 당근 세션 만료 — 로컬에서 재로그인 후 storageState 재추출·복사 필요");
      return;
    }
    const text = await page.evaluate(() => document.body.innerText);
    const data = parseAds(text.replace(/\s+/g, " "));
    const payload = { updatedAt: new Date().toISOString(), advertiserId: ADVERTISER, ...data };
    writeFileSync(OUT, JSON.stringify(payload, null, 2));
    await pushToServer("/api/daangn-ads", payload);
    console.log(`✅ 당근: 광고 ${data.ads.length}건 · 캐시 ${data.cash?.toLocaleString()}원 · 노출 ${data.total.impressions} 클릭 ${data.total.clicks} 지출 ${data.total.spend}`);
  } catch (e) {
    console.error("❌", e.message);
  } finally {
    await ctx.close();
    await browser.close();
  }
}
main();
