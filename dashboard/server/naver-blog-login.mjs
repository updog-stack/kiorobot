// 네이버 블로그 통계 로그인 세션 갱신 — 창에서 직접 로그인 → 통계(admin) 접근 세션 저장.
// 세션 만료 시 실행. 이후 naver-blog-scraper.mjs 가 세션 재사용.
//
// 블로그가 여러 개면 계정도 다를 수 있으므로 블로그마다 별도 프로필에 세션을 저장한다.
//   node naver-blog-login.mjs          → 1번 블로그(기본)
//   node naver-blog-login.mjs 2        → 2번 블로그
//   node naver-blog-login.mjs kiorobot → 블로그 ID로 지정
//   node naver-blog-login.mjs --all    → 설정된 블로그 전부(순서대로 창이 뜸)
import "dotenv/config";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = (f) => join(__dirname, "data", f);

// naver-blog-scraper.mjs 의 BLOGS 와 같은 구성을 유지할 것.
const BLOGS = [
  {
    id: process.env.NAVER_BLOG_ID || "dain_inc",
    label: process.env.NAVER_BLOG_LABEL || "다인아이앤씨 블로그",
    profile: dataPath("naver-profile"),
  },
];
if (process.env.NAVER_BLOG_ID_2) {
  BLOGS.push({
    id: process.env.NAVER_BLOG_ID_2,
    label: process.env.NAVER_BLOG_LABEL_2 || `${process.env.NAVER_BLOG_ID_2} 블로그`,
    profile: dataPath("naver-profile-2"),
  });
}

const arg = (process.argv[2] || "").trim();
let targets;
if (arg === "--all" || arg === "all") targets = BLOGS;
else if (!arg) targets = [BLOGS[0]];
else if (/^\d+$/.test(arg)) targets = [BLOGS[Number(arg) - 1]];
else targets = [BLOGS.find((b) => b.id === arg)];

if (!targets[0]) {
  console.error(`대상 블로그를 찾을 수 없습니다: "${arg}"`);
  console.error("설정된 블로그:");
  BLOGS.forEach((b, i) => console.error(`  ${i + 1}. ${b.id}  (${b.label})`));
  console.error("전부 로그인하려면: node naver-blog-login.mjs --all");
  process.exit(1);
}

// 블로그 1개 로그인 → 성공 여부 반환
async function loginTo(blog) {
  const statUrl = `https://admin.blog.naver.com/${blog.id}/stat/today`;
  console.log(`\n네이버 블로그 통계 로그인 창을 엽니다 — ${blog.label} (${blog.id})`);
  const ctx = await chromium.launchPersistentContext(blog.profile, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  let ok = 0;
  try {
    await page.goto(statUrl, { waitUntil: "domcontentloaded", timeout: 40000 });
    console.log("▶ 창에서 네이버 로그인 하세요. 로그인만 끝나면 나머지는 자동입니다. 최대 10분 대기…\n");

    // 1단계: 로그인 페이지(nid.naver.com)를 벗어날 때까지 대기.
    //   ※ 로그인 후 네이버는 /stat/today 를 떼고 블로그 홈으로 보내므로
    //     주소에 'stat' 이 있는지로 판단하면 안 된다.
    let leftLogin = false;
    for (let i = 0; i < 300; i++) {
      await page.waitForTimeout(2000);
      if (!/nid\.naver\.com/.test(page.url())) { leftLogin = true; break; }
      if (i > 0 && i % 30 === 0) console.log(`   …대기 중 (${i * 2}초)`);
    }

    // 2단계: 통계 페이지로 직접 이동해서 실제로 열리는지 확인.
    if (leftLogin) {
      await page.goto(statUrl, { waitUntil: "networkidle", timeout: 40000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const u = page.url();
      if (/admin\.blog\.naver\.com/.test(u) && !/nid\.naver\.com|nidlogin/.test(u)) ok = 3;
    }

    if (ok < 3) {
      console.log(`⚠️ ${blog.label} 통계 진입 확인 안 됨(로그인 미완료?)`);
    } else {
      // 통계 화면까지 갔어도 '로그인 상태 유지'를 안 켜면 세션 쿠키라서
      // 창을 닫는 순간 사라진다 → 다음 수집에서 다시 로그인 페이지로 튕긴다.
      const auth = (await ctx.cookies()).filter((c) => /^NID_(AUT|SES)$/.test(c.name));
      const persistent = auth.some((c) => typeof c.expires === "number" && c.expires > 0);
      if (persistent) {
        console.log(`✅ ${blog.label} 세션 저장됨 (브라우저 종료 후에도 유지)`);
      } else {
        ok = 0; // 저장 실패로 취급
        console.log(`❌ ${blog.label} 세션이 저장되지 않았습니다.`);
        console.log(`   네이버 로그인 화면에서 '로그인 상태 유지'를 켜고 다시 로그인해 주세요.`);
        console.log(`   (끄면 창을 닫는 순간 세션이 사라져 수집이 실패합니다)`);
      }
    }
  } catch (e) {
    console.error(`오류(${blog.label}):`, e.message);
  } finally {
    await page.waitForTimeout(1500);
    await ctx.close();
  }
  return ok >= 3;
}

const results = [];
for (const blog of targets) {
  results.push({ label: blog.label, ok: await loginTo(blog) });
}

if (results.length > 1) {
  console.log("\n── 결과 ──");
  for (const r of results) console.log(`  ${r.ok ? "✅" : "⚠️"} ${r.label}`);
}
