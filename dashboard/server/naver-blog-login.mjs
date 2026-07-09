// 네이버 블로그 통계 로그인 세션 갱신 — 창에서 직접 로그인 → 통계(admin) 접근 세션 저장.
// 세션 만료 시 실행. 이후 naver-blog-scraper.mjs 가 세션 재사용.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, "data", "naver-profile");
const BLOG_ID = process.env.NAVER_BLOG_ID || "dain_inc";
const STAT_URL = `https://admin.blog.naver.com/${BLOG_ID}/stat/today`;

console.log("네이버 블로그 통계 로그인 창을 엽니다…");
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  await page.goto(STAT_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
  console.log("\n▶ 창에서 네이버 로그인 → 블로그 '통계' 화면이 보이면 자동 저장 후 닫힙니다. 최대 5분 대기…\n");
  let ok = 0;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(2000);
    const u = page.url();
    // 통계(admin.blog + stat) 진입, 로그인 페이지 아님 → 성공
    if (/admin\.blog\.naver\.com/.test(u) && /stat/.test(u) && !/nidlogin|login/.test(u)) { ok++; if (ok >= 3) break; } else ok = 0;
  }
  console.log(ok >= 3 ? "✅ 통계 세션 저장됨 → " + page.url().slice(0, 60) : "⚠️ 통계 진입 확인 안 됨(로그인 미완료?)");
} catch (e) {
  console.error("오류:", e.message);
} finally {
  await page.waitForTimeout(1500);
  await ctx.close();
}
