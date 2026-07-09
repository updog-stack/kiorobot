// 당근 비즈니스 로그인 세션 캡처 — 브라우저를 띄워 사람이 직접 로그인 → 세션(프로필) 저장.
// 이후 daangn-ads-scraper.mjs 가 이 프로필을 재사용해 자동 조회. 세션 만료 시 다시 실행.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, "data", "daangn-profile"); // 세션 저장 디렉토리(git 제외)
const LOGIN_URL = "https://business.daangn.com/login";

console.log("당근 비즈니스 로그인 창을 엽니다…");
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
  console.log("\n▶ 열린 브라우저에서 당근 비즈니스에 로그인하세요.");
  console.log("  (당근 계정=휴대폰 인증 / PC계정=Google·카카오·네이버 중 편한 방법)");
  console.log("  로그인 완료(광고 관리 화면 진입)되면 자동 감지 후 세션 저장하고 닫힙니다. 최대 5분 대기…\n");
  let stable = 0, lastUrl = "";
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(2000);
    let u = "";
    try { u = page.url(); } catch { u = lastUrl; }
    lastUrl = u;
    // 로그인 페이지를 벗어나 당근/캐롯 도메인에서 안정적으로 유지되면 로그인 성공으로 판단
    if (u && !/\/login|nid\.|accounts\.google|kauth\.kakao|nid\.naver/.test(u) && /daangn|karrot/.test(u)) {
      stable++;
      if (stable >= 4) { console.log("✅ 로그인 감지됨:", u); break; }
    } else stable = 0;
  }
  console.log("세션 저장 완료 →", PROFILE);
} catch (e) {
  console.error("오류:", e.message);
} finally {
  await ctx.close();
}
