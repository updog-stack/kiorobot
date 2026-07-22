// 네이버 블로그 통계 수집(다중 블로그) — 조회수(일별) + 방문자. 세션 재사용(화면 있는 모드).
//  · 네이버는 헤드리스 차단 → headless:false(창이 잠깐 뜸). 세션 유지되어 재로그인 불필요.
//  · 블로그별로 세션(계정)이 다를 수 있음 → 각 블로그마다 별도 프로필/스테이트 사용.
//  · 블로그1: NAVER_BLOG_ID(기본 dain_inc). 블로그2: NAVER_BLOG_ID_2 설정 시 추가 수집.
//  · 세션 만료 시 naver-blog-login(계정별)로 1회 재로그인.
// 저장: server/data/naver-blog.json { updatedAt, blogs: [ {blogId,label,today,...}, ... ] }  (BFF /api/naver-blog)
import "dotenv/config";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pushToServer } from "./lib/push-to-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = (f) => join(__dirname, "data", f);
const OUT = dataPath("naver-blog.json");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 수집 대상 블로그(계정별 세션 분리). 2번째는 환경변수 있을 때만.
const BLOGS = [
  { id: process.env.NAVER_BLOG_ID || "dain_inc", label: process.env.NAVER_BLOG_LABEL || "다인아이앤씨 블로그", state: dataPath("naver-state.json"), profile: dataPath("naver-profile") },
];
if (process.env.NAVER_BLOG_ID_2) {
  BLOGS.push({ id: process.env.NAVER_BLOG_ID_2, label: process.env.NAVER_BLOG_LABEL_2 || `${process.env.NAVER_BLOG_ID_2} 블로그`, state: dataPath("naver-state-2.json"), profile: dataPath("naver-profile-2") });
}

function seriesOf(json, key) {
  const d = json?.result?.statDataList?.[0]?.data;
  if (!d?.rows?.date) return null;
  const col = d.columnInfo?.includes(key) ? key : d.columnInfo?.[1];
  return { dates: d.rows.date, values: (d.rows[col] || []).map(Number) };
}

// 블로그 1개 수집 → 결과 객체(실패 시 error/loggedOut 포함)
async function collectBlog(blog) {
  const statUrl = `https://admin.blog.naver.com/${blog.id}/stat/today`;
  const useState = process.env.NAVER_STATE === "1" && existsSync(blog.state); // 서버: storageState / 로컬: persistent 프로필
  let browser = null, ctx;
  try {
    if (useState) {
      browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
      ctx = await browser.newContext({ storageState: blog.state, viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });
    } else {
      ctx = await chromium.launchPersistentContext(blog.profile, { headless: false, viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });
    }
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const cap = {};
    ctx.on("response", async (r) => {
      const m = r.url().match(/blog\.stat\.naver\.com\/api\/blog\/daily\/(\w+)/);
      if (m) { try { cap[m[1]] = JSON.parse(await r.text()); } catch {} }
    });
    await page.goto(statUrl, { waitUntil: "networkidle", timeout: 40000 });
    await wait(7000);
    if (/nidlogin|login/.test(page.url())) {
      return { blogId: blog.id, label: blog.label, error: "네이버 세션 만료 — 재로그인 필요", loggedOut: true };
    }
    const cv = seriesOf(cap.cv, "cv"); // 조회수
    const uv = seriesOf(cap.uv, "uv"); // 순방문자(있으면)
    if (!cv) return { blogId: blog.id, label: blog.label, error: "조회수(cv) 데이터를 못 받음" };
    return {
      blogId: blog.id,
      label: blog.label,
      today: cv.values[0] ?? 0,
      yesterday: cv.values[1] ?? 0,
      last7: cv.values.slice(0, 7).reduce((a, b) => a + b, 0),
      last30: cv.values.slice(0, 30).reduce((a, b) => a + b, 0),
      views: { dates: cv.dates.slice(0, 30), values: cv.values.slice(0, 30) },
      visitors: uv ? { today: uv.values[0] ?? 0, last7: uv.values.slice(0, 7).reduce((a, b) => a + b, 0) } : null,
    };
  } catch (e) {
    return { blogId: blog.id, label: blog.label, error: e.message };
  } finally {
    if (ctx) await ctx.close();
    if (browser) await browser.close();
  }
}

async function main() {
  const blogs = [];
  for (const blog of BLOGS) {
    console.log(`· 수집 시작: ${blog.label} (${blog.id})`);
    blogs.push(await collectBlog(blog));
  }
  const out = { updatedAt: new Date().toISOString(), blogs };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2));
  await pushToServer("/api/naver-blog", out);
  for (const r of blogs) {
    console.log(r.error ? `⚠️ ${r.label}: ${r.error}` : `✅ ${r.label}: 오늘 ${r.today} · 최근7일 ${r.last7} · 최근30일 ${r.last30}`);
  }
}
main();
