// 당근 광고 지표 1회 수집(서버용) — 이식된 storageState 로 로그인, DOM에서 지표 추출 후 종료.
//   · 서버(리눅스)는 Xvfb 가상화면 위에서 headless:false 로 실행: xvfb-run -a node server/daangn-ads-once.mjs
//   · 세션은 data/daangn-state.json (로컬에서 추출해 복사). 만료 시 로컬 재로그인→재추출→재복사.
//   · 파싱은 daangn-ads-daemon.mjs 것을 그대로 가져다 쓴다.
//     예전엔 같은 정규식을 복사해 뒀는데, 데몬만 고치는 바람에 서버는 계속
//     구버전으로 수집했다(검색광고 누락·소재 미수집). 파서를 두 벌로 두지 말 것.
import "dotenv/config";
import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pushToServer } from "./lib/push-to-server.mjs";
import { parseAds, parseCreativeDetail } from "./daangn-ads-daemon.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE = join(__dirname, "data", "daangn-state.json");
const OUT = join(__dirname, "data", "daangn-ads.json");
const DBG = join(__dirname, "data", "_daangn-dom.txt");
const ADVERTISER = process.env.DAANGN_ADVERTISER_ID || "3794527";
const ADS = `https://ads-lite.business.daangn.com/advertisements/?advertiserId=${ADVERTISER}&advertiser_id=${ADVERTISER}`;

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
    writeFileSync(DBG, text);
    const data = parseAds(text.replace(/\s+/g, " "));

    // 소재별 노출·클릭·지출은 그룹 상세에만 있다. 목록의 그룹 링크가 곧 상세 주소.
    const groupLinks = await page.$$eval("a[href*='/ad-groups/']", (as) => [...new Set(as.map((a) => a.href))]);
    for (let i = 0; i < data.ads.length && i < groupLinks.length; i++) {
      try {
        await page.goto(groupLinks[i], { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(3500);
        const dt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        const detailed = parseCreativeDetail(dt);
        if (detailed.length) data.ads[i].creatives = detailed;
      } catch (e) {
        console.log(`  상세 수집 실패(${data.ads[i].name}): ${e.message}`);
      }
    }

    const payload = { updatedAt: new Date().toISOString(), advertiserId: ADVERTISER, ...data };
    writeFileSync(OUT, JSON.stringify(payload, null, 2));
    await pushToServer("/api/daangn-ads", payload);
    const nCreatives = data.ads.reduce((n, a) => n + (a.creatives?.length || 0), 0);
    console.log(`✅ 당근: 광고 ${data.ads.length}건(소재 ${nCreatives}개) · 캐시 ${data.cash?.toLocaleString()}원 · 노출 ${data.total.impressions} 클릭 ${data.total.clicks} 지출 ${data.total.spend}`);
  } catch (e) {
    console.error("❌", e.message);
  } finally {
    await ctx.close();
    await browser.close();
  }
}
main();
