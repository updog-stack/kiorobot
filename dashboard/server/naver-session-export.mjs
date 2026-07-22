// 로컬 브라우저 프로필의 네이버 로그인 세션을 storageState(JSON)로 추출한다.
//
// 왜 필요한가: 서버(리눅스)는 윈도우의 브라우저 프로필을 그대로 못 쓴다.
//   쿠키가 OS 단위로 암호화돼 있어 폴더를 복사해도 복호화가 안 된다.
//   그래서 쿠키만 뽑은 storageState 파일을 만들어 서버로 옮기고,
//   서버는 NAVER_STATE=1 로 그 파일을 읽어 쓴다.
//
//   node naver-session-export.mjs         → 1번 블로그
//   node naver-session-export.mjs 2       → 2번 블로그
//   node naver-session-export.mjs --all   → 설정된 블로그 전부
//
// 만들어진 파일을 서버로 올리는 방법:
//   scp server/data/naver-state.json   root<서버>:/root/kiorobot/dashboard/server/data/
//   scp server/data/naver-state-2.json root<서버>:/root/kiorobot/dashboard/server/data/
import "dotenv/config";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = (f) => join(__dirname, "data", f);

// naver-blog-scraper.mjs / naver-blog-login.mjs 와 같은 구성을 유지할 것.
const BLOGS = [
  {
    id: process.env.NAVER_BLOG_ID || "dain_inc",
    label: process.env.NAVER_BLOG_LABEL || "다인아이앤씨 블로그",
    profile: dataPath("naver-profile"),
    state: dataPath("naver-state.json"),
  },
];
if (process.env.NAVER_BLOG_ID_2) {
  BLOGS.push({
    id: process.env.NAVER_BLOG_ID_2,
    label: process.env.NAVER_BLOG_LABEL_2 || `${process.env.NAVER_BLOG_ID_2} 블로그`,
    profile: dataPath("naver-profile-2"),
    state: dataPath("naver-state-2.json"),
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
  BLOGS.forEach((b, i) => console.error(`  ${i + 1}. ${b.id}  (${b.label})`));
  process.exit(1);
}

let failed = 0;
for (const blog of targets) {
  console.log(`\n[${blog.label}] ${blog.id}`);
  if (!existsSync(blog.profile)) {
    console.log(`   ✗ 프로필 없음: ${blog.profile}`);
    console.log(`     먼저 로그인하세요 → node server/naver-blog-login.mjs ${BLOGS.indexOf(blog) + 1}`);
    failed++;
    continue;
  }
  const ctx = await chromium.launchPersistentContext(blog.profile, { headless: true });
  try {
    await ctx.storageState({ path: blog.state });
    const { cookies } = await ctx.storageState();
    const auth = cookies.filter((c) => /^NID_(AUT|SES)$/.test(c.name));
    if (!auth.length) {
      console.log("   ✗ 인증 쿠키(NID_AUT/NID_SES)가 없습니다 — 로그인이 안 된 프로필입니다.");
      failed++;
    } else {
      for (const c of auth) {
        const exp = c.expires > 0 ? new Date(c.expires * 1000).toISOString().slice(0, 16) : null;
        console.log(`   ${c.name.padEnd(8)} ${exp ? "유효 ~" + exp : "세션쿠키(이식 불가)"}`);
      }
      console.log(`   ✓ 저장: ${blog.state}`);
    }
  } catch (e) {
    console.log("   ✗ 실패:", e.message);
    failed++;
  } finally {
    await ctx.close();
  }
}

if (failed) {
  console.log(`\n${failed}건 실패.`);
  process.exit(1);
}
console.log("\n완료. 위 파일을 서버의 server/data/ 로 복사하면 됩니다.");
