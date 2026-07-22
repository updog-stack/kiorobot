// 로컬 로그인 세션(네이버 블로그 + 당근)을 서버용 storageState 파일로 한 번에 추출한다.
//
// 왜 필요한가: 서버(리눅스)는 윈도우 브라우저 프로필을 그대로 못 쓴다(쿠키가 OS 단위로 암호화).
//   쿠키만 담긴 storageState 파일을 뽑아 서버로 옮기면 서버가 그걸로 로그인한다.
//
// 세션 수명 (실측)
//   · 네이버 : 로그인 시점부터 약 1개월. 수집 때마다 갱신되어 더 늘어나기도 한다.
//   · 당근   : 로그인 시점부터 약 11일. 고정 만료라 수집해도 연장되지 않는다. ← 이게 갱신 주기를 결정
//
//   node server/session-export.mjs          → 전부 추출
//   node server/session-export.mjs naver    → 네이버만
//   node server/session-export.mjs daangn   → 당근만
//
// 추출 후 서버로 올리기(윈도우에서):
//   세션갱신.bat  ← 추출 + 업로드를 한 번에
import "dotenv/config";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = (f) => join(__dirname, "data", f);
const days = (sec) => Math.round((sec * 1000 - Date.now()) / 86400000);

// 추출 대상. 인증 쿠키 이름은 만료 판정용.
const TARGETS = [
  {
    kind: "naver",
    label: process.env.NAVER_BLOG_LABEL || "다인아이앤씨 블로그",
    profile: dataPath("naver-profile"),
    state: dataPath("naver-state.json"),
    authRe: /^NID_(AUT|SES)$/,
    relogin: "node server/naver-blog-login.mjs 1",
  },
];
if (process.env.NAVER_BLOG_ID_2) {
  TARGETS.push({
    kind: "naver",
    label: process.env.NAVER_BLOG_LABEL_2 || `${process.env.NAVER_BLOG_ID_2} 블로그`,
    profile: dataPath("naver-profile-2"),
    state: dataPath("naver-state-2.json"),
    authRe: /^NID_(AUT|SES)$/,
    relogin: "node server/naver-blog-login.mjs 2",
  });
}
TARGETS.push({
  kind: "daangn",
  label: "당근 광고",
  profile: dataPath("daangn-profile"),
  state: dataPath("daangn-state.json"),
  authRe: /^_session$/,
  relogin: "node server/daangn-ads-daemon.mjs  (창에서 로그인 후 Ctrl+C)",
});

const arg = (process.argv[2] || "").trim().toLowerCase();
const targets = arg ? TARGETS.filter((t) => t.kind === arg) : TARGETS;
if (!targets.length) {
  console.error(`대상 없음: "${arg}"  (naver | daangn | 생략=전부)`);
  process.exit(1);
}

let failed = 0;
for (const t of targets) {
  console.log(`\n[${t.label}]`);
  if (!existsSync(t.profile)) {
    console.log(`   ✗ 프로필 없음 — 먼저 로그인: ${t.relogin}`);
    failed++;
    continue;
  }
  const ctx = await chromium.launchPersistentContext(t.profile, { headless: true });
  try {
    await ctx.storageState({ path: t.state });
    const { cookies } = await ctx.storageState();
    const auth = cookies.filter((c) => t.authRe.test(c.name) && c.expires > 0);
    if (!auth.length) {
      console.log(`   ✗ 인증 쿠키 없음(로그인 안 된 프로필) — 재로그인: ${t.relogin}`);
      failed++;
      continue;
    }
    const soonest = Math.min(...auth.map((c) => c.expires));
    const left = days(soonest);
    const mark = left <= 0 ? "✗ 만료됨" : left <= 3 ? "⚠ 곧 만료" : "✓";
    console.log(`   ${mark} 만료 ${new Date(soonest * 1000).toISOString().slice(0, 16)} (${left}일 남음)`);
    console.log(`     → ${t.state}`);
    if (left <= 0) { console.log(`     재로그인 필요: ${t.relogin}`); failed++; }
  } catch (e) {
    console.log("   ✗ 실패:", e.message);
    failed++;
  } finally {
    await ctx.close();
  }
}

console.log(
  failed
    ? `\n${failed}건 문제 있음 — 위 안내대로 재로그인 후 다시 실행하세요.`
    : "\n완료. 이제 서버로 업로드하면 됩니다."
);
process.exit(failed ? 1 : 0);
