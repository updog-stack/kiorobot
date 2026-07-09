// 네이버 블로그(dain_inc) 통계 수집 — 세션 재사용(화면 있는 모드). 조회수(일별) + 방문자.
//  · 네이버는 헤드리스를 차단하므로 headless:false(창이 잠깐 뜸). 세션은 유지되어 재로그인 불필요.
//  · 세션 만료 시 naver-blog-login.bat 로 1회 재로그인.
// 저장: server/data/naver-blog.json  (BFF /api/naver-blog)
import "dotenv/config";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pushToServer } from "./lib/push-to-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, "data", "naver-profile");
const OUT = join(__dirname, "data", "naver-blog.json");
const BLOG_ID = process.env.NAVER_BLOG_ID || "dain_inc";
const STAT_URL = `https://admin.blog.naver.com/${BLOG_ID}/stat/today`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function seriesOf(json, key) {
  const d = json?.result?.statDataList?.[0]?.data;
  if (!d?.rows?.date) return null;
  const col = d.columnInfo?.includes(key) ? key : d.columnInfo?.[1];
  return { dates: d.rows.date, values: (d.rows[col] || []).map(Number) };
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const cap = {};
  ctx.on("response", async (r) => {
    const u = r.url();
    const m = u.match(/blog\.stat\.naver\.com\/api\/blog\/daily\/(\w+)/);
    if (m) { try { cap[m[1]] = JSON.parse(await r.text()); } catch {} }
  });
  try {
    await page.goto(STAT_URL, { waitUntil: "networkidle", timeout: 40000 });
    await wait(7000);
    if (/nidlogin|login/.test(page.url())) {
      const lo = { updatedAt: new Date().toISOString(), error: "네이버 세션 만료 — 재로그인 필요", loggedOut: true };
      await mkdir(dirname(OUT), { recursive: true });
      await writeFile(OUT, JSON.stringify(lo, null, 2));
      await pushToServer("/api/naver-blog", lo);
      console.log("⚠️ 세션 만료 — naver-blog-login.bat 로 재로그인 필요");
      return;
    }
    const cv = seriesOf(cap.cv, "cv");   // 조회수
    const uv = seriesOf(cap.uv, "uv");   // 순방문자수(있으면)
    if (!cv) throw new Error("조회수(cv) 데이터를 못 받음");
    const out = {
      updatedAt: new Date().toISOString(),
      blogId: BLOG_ID,
      today: cv.values[0] ?? 0,
      yesterday: cv.values[1] ?? 0,
      last7: cv.values.slice(0, 7).reduce((a, b) => a + b, 0),
      last30: cv.values.slice(0, 30).reduce((a, b) => a + b, 0),
      views: { dates: cv.dates.slice(0, 30), values: cv.values.slice(0, 30) },
      visitors: uv ? { today: uv.values[0] ?? 0, last7: uv.values.slice(0, 7).reduce((a, b) => a + b, 0) } : null,
    };
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(out, null, 2));
    await pushToServer("/api/naver-blog", out);
    console.log(`✅ 블로그: 오늘 조회 ${out.today} · 최근7일 ${out.last7} · 최근30일 ${out.last30}${uv ? ` · 순방문(오늘) ${out.visitors.today}` : ""}`);
  } catch (e) {
    console.error("❌", e.message);
  } finally {
    await ctx.close();
  }
}
main();
