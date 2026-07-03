// 노션 매출 BFF (Backend-for-Frontend) — Notion API 2025-09-03 / data source 모델
//
// master.md §5.5: 노션 API 키는 브라우저에 노출 금지 → 이 백엔드가 키를 보관하고
// 노션 매출 DB(데이터소스)를 조회해 [{ date, amount }] 형태로 내려줍니다.
//
// 이 회사 설정(notion-inspect.mjs 분석 결과 + 사용자 확인):
//   - [다인] 장비매출 DB      : 날짜=날짜,            금액=총액(VAT 포함),   단위=천원(×1000)
//   - [다인] 할부/렌탈 매출 DB : 날짜=할부일(신청일),  금액=정산금액(VAT포함), 단위=원(×1)
//   → 두 DB를 합산하여 전체 매출로 제공.
//
// 사용법:
//   1) npm i express dotenv @notionhq/client
//   2) .env 에 NOTION_TOKEN 작성
//   3) node server/notion-sales-bff.mjs
//   4) src/lib/sales.ts 의 USE_MOCK = false

import "dotenv/config";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createSign } from "node:crypto";
import express from "express";
import { Client } from "@notionhq/client";
import { createAuth, parseCookies, buildCookie, COOKIE_NAME } from "./lib/auth.mjs";
import { buildWorklogData, generateAiComment, generateDigest, generateMonthlyDigest, worklogToText, buildWorklogHtml } from "./lib/worklog.mjs";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TR_JSON = join(__dirname, "data", "tr.json");
const TR_DDWM_JSON = join(__dirname, "data", "tr-ddwm.json");
const INACTIVE_JSON = join(__dirname, "data", "inactive.json");
const INACTIVE_DDWM_JSON = join(__dirname, "data", "inactive-ddwm.json");
const INACTIVE_STATUS_JSON = join(__dirname, "data", "inactive-status.json");
const DDWM_SALES_JSON = join(__dirname, "data", "ddwm-sales-2025.json");
const PLAYBOOKS_JSON = join(__dirname, "data", "playbooks.json");
const UPLOADS_DIR = join(__dirname, "data", "uploads"); // 꿀팁게시판 첨부 사진 저장
const CS_INDEX_JSON = join(__dirname, "data", "cs-index.json"); // 상담 기록 검색 인덱스
const WORKLOGS_DIR = join(__dirname, "data", "worklogs"); // 매일 18:00 자동 업무일지
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
if (!existsSync(WORKLOGS_DIR)) mkdirSync(WORKLOGS_DIR, { recursive: true });

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

const { NOTION_TOKEN, BFF_PORT = 8787, APP_PASSWORD, SESSION_SECRET } = process.env;
if (!NOTION_TOKEN) {
  console.error("환경변수 NOTION_TOKEN 이 필요합니다 (.env).");
  process.exit(1);
}

// 구글캘린더 — 일정 탭용. 미설정이어도 BFF는 정상 기동.
// 방식 A(간단): GOOGLE_CALENDAR_ICS_URL — 캘린더 설정의 'iCal 비공개 주소' 한 줄
// 방식 B(서비스계정): GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY + GOOGLE_CALENDAR_ID
const {
  GOOGLE_CALENDAR_ICS_URL,
  GOOGLE_SA_EMAIL,
  GOOGLE_SA_PRIVATE_KEY,
  GOOGLE_CALENDAR_ID,
  GOOGLE_CALENDARS, // 양방향(쓰기)용: "라벨|캘린더ID,라벨|캘린더ID"
} = process.env;

// 서비스계정 + GOOGLE_CALENDARS 가 있으면 API 양방향 모드(생성·수정·삭제 가능)
const API_CALENDARS = (GOOGLE_CALENDARS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry, i) => {
    const pipe = entry.indexOf("|");
    return pipe === -1
      ? { label: `캘린더${i + 1}`, id: entry }
      : { label: entry.slice(0, pipe).trim(), id: entry.slice(pipe + 1).trim() };
  });
const API_MODE = Boolean(
  GOOGLE_SA_EMAIL && GOOGLE_SA_PRIVATE_KEY && API_CALENDARS.length
);
const TZ = "Asia/Seoul";

// 합산할 매출 데이터소스 정의
const SOURCES = [
  {
    name: "장비매출",
    dataSourceId: "42f364ab-cc7f-83b0-ab41-8747348eaa89",
    dateProp: "날짜",
    amountProp: "총액(VAT 포함)",
    scale: 1, // 원 단위 (구분별 분포 검증: 기타·라이선스·장비매출 모두 원)
  },
  {
    name: "할부/렌탈",
    dataSourceId: "b43364ab-cc7f-82c9-9f32-07a6072d2560",
    dateProp: "할부일(신청일)",
    amountProp: "정산금액(VAT포함)",
    scale: 1,
  },
];

const notion = new Client({ auth: NOTION_TOKEN });
const app = express();
// Caddy/Nginx 등 리버스 프록시 뒤에서 req.ip·x-forwarded-proto 를 신뢰
app.set("trust proxy", true);

// ───────── 접근제어(로그인) ─────────
// 같은 출처(dev=Vite 프록시, prod=정적 서빙)에서만 호출되므로 CORS 는 닫는다.
const auth = createAuth({ password: APP_PASSWORD, secret: SESSION_SECRET });
if (!auth.enabled) {
  console.warn(
    "\n⚠️  APP_PASSWORD 미설정 → 로그인 비활성(누구나 접속 가능).\n" +
      "    외부 서버로 오픈하기 전 .env 에 APP_PASSWORD 를 반드시 설정하세요.\n"
  );
} else if (auth.ephemeralSecret) {
  console.warn(
    "⚠️  SESSION_SECRET 미설정 → 임시 키 사용(서버 재시작 시 전원 재로그인). .env 에 고정 권장."
  );
}

// 기본 보안 헤더(외부 의존성 없이 helmet 핵심만)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-XSS-Protection", "0");
  next();
});

// 블로그 검사기·꿀팁 첨부사진(base64)을 함께 보내므로 본문 한도를 넉넉히(기본 100kb→25mb)
app.use(express.json({ limit: "25mb" }));

// 로그인 무차별 대입 방지(IP당 15분 내 10회 실패 → 잠금)
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
const loginFails = new Map(); // ip -> { n, ts }
function loginLocked(ip) {
  const e = loginFails.get(ip);
  if (!e || Date.now() - e.ts > LOGIN_WINDOW_MS) return false;
  return e.n >= LOGIN_MAX_FAILS;
}
function noteLoginFail(ip) {
  const now = Date.now();
  const e = loginFails.get(ip);
  if (!e || now - e.ts > LOGIN_WINDOW_MS) loginFails.set(ip, { n: 1, ts: now });
  else e.n += 1;
}

const cookieSecure = (req) =>
  req.secure || req.headers["x-forwarded-proto"] === "https";

// 세션 상태(로그인 화면 분기용) — 인증 불필요
app.get("/api/session", (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  res.json({ authRequired: auth.enabled, authed: !auth.enabled || auth.verifyToken(token) });
});

app.post("/api/login", (req, res) => {
  if (!auth.enabled) return res.json({ ok: true }); // 비활성 모드
  const ip = req.ip || "?";
  if (loginLocked(ip))
    return res.status(429).json({ error: "too_many_attempts" });
  if (!auth.checkPassword(req.body?.password)) {
    noteLoginFail(ip);
    return res.status(401).json({ error: "invalid_password" });
  }
  loginFails.delete(ip);
  res.setHeader(
    "Set-Cookie",
    buildCookie(COOKIE_NAME, auth.issueToken(), {
      maxAgeMs: auth.sessionMs,
      secure: cookieSecure(req),
    })
  );
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    buildCookie(COOKIE_NAME, "", { maxAgeMs: 0, secure: cookieSecure(req) })
  );
  res.json({ ok: true });
});

// 게이트: /api/* 는 로그인 필수(위 인증 엔드포인트·정적 SPA 제외)
app.use((req, res, next) => {
  if (!auth.enabled) return next();
  const p = req.path;
  if (!p.startsWith("/api")) return next(); // 정적 SPA(로그인 화면 포함)
  if (p === "/api/session" || p === "/api/login" || p === "/api/logout")
    return next();
  if (auth.verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]))
    return next();
  return res.status(401).json({ error: "unauthorized" });
});

// 업로드된 첨부 사진 서빙(로그인 게이트 뒤 → 인증된 사용자만)
app.use("/api/uploads", express.static(UPLOADS_DIR));

const CS_OVERRIDE_JSON = join(__dirname, "data", "cs-status-override.json");

// number / formula / rollup 모두에서 숫자 추출
function numberOf(prop) {
  if (!prop) return undefined;
  if (prop.type === "number") return prop.number;
  if (prop.type === "formula") return prop.formula?.number;
  if (prop.type === "rollup") return prop.rollup?.number;
  return undefined;
}
function dateOf(prop) {
  if (prop?.type === "date") return prop.date?.start;
  if (prop?.type === "created_time") return prop.created_time;
  return undefined;
}

async function loadSource(src) {
  const records = [];
  let cursor;
  do {
    const res = await notion.dataSources.query({
      data_source_id: src.dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties ?? {};
      const date = dateOf(props[src.dateProp]);
      const raw = numberOf(props[src.amountProp]);
      if (date && typeof raw === "number") {
        records.push({ date: date.slice(0, 10), amount: raw * src.scale });
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(`  · ${src.name}: ${records.length}건`);
  return records;
}

async function loadAllSales() {
  console.log("노션 매출 조회…");
  const all = [];
  for (const src of SOURCES) {
    all.push(...(await loadSource(src)));
  }
  console.log(`  합계: ${all.length}건`);
  return all;
}

// 간단 캐시: 노션 API 호출 한도(초당 ~3req) 보호 (master.md §5.5)
let cache = { at: 0, data: null };
const TTL_MS = 30_000;

app.get("/api/sales", async (_req, res) => {
  try {
    const now = Date.now();
    if (!cache.data || now - cache.at > TTL_MS) {
      cache = { at: now, data: await loadAllSales() };
    }
    res.json(cache.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 거래(TR) 현황 — 코밴 + 다우데이타 VAN별 + 합산(월별 건수)
async function buildTr() {
  const kovan = await readJson(TR_JSON);
  const ddwm = await readJson(TR_DDWM_JSON);
  const year = kovan?.year ?? ddwm?.year ?? new Date().getFullYear();

  const vans = [];
  if (kovan)
    vans.push({ van: "KOVAN", label: "코밴", monthly: kovan.monthly ?? [], total: kovan.total ?? 0, avg: kovan.avg ?? 0, updatedAt: kovan.updatedAt ?? null });
  if (ddwm)
    vans.push({ van: "DAOUDATA", label: "다우데이타", monthly: ddwm.monthly ?? [], total: ddwm.total ?? 0, avg: ddwm.avg ?? 0, updatedAt: ddwm.updatedAt ?? null });

  const map = {};
  for (const v of vans) for (const m of v.monthly) map[m.month] = (map[m.month] ?? 0) + m.count;
  const months = Object.keys(map).map(Number).sort((a, b) => a - b);
  const combinedMonthly = months.map((m) => ({ month: m, count: map[m] }));
  const combinedTotal = combinedMonthly.reduce((s, x) => s + x.count, 0);
  const monthsElapsed = months.length;

  return {
    updatedAt: vans.map((v) => v.updatedAt).filter(Boolean).sort().pop() ?? null,
    year,
    vans,
    combined: { monthly: combinedMonthly, total: combinedTotal, avg: monthsElapsed ? combinedTotal / monthsElapsed : 0 },
    note: vans.length ? undefined : "아직 수집 전 — '지금 동기화' 또는 매일 08:00 자동 수집 후 표시됩니다.",
  };
}

app.get("/api/tr", async (_req, res) => {
  res.json(await buildTr());
});

// 무실적 가맹점 — 코밴 + 다우데이타 합쳐서 VAN별 + 합산 (+ 국세청 사업자상태 병합)
async function buildInactive() {
  const kovan = await readJson(INACTIVE_JSON);
  const ddwm = await readJson(INACTIVE_DDWM_JSON);
  const statusFile = await readJson(INACTIVE_STATUS_JSON);
  const statuses = statusFile?.statuses ?? {};
  const salesFile = await readJson(DDWM_SALES_JSON);
  const sales = salesFile?.byBiz ?? {};
  const withStatus = (s, vanLabel) => ({
    ...s,
    van: vanLabel,
    status: statuses[s.bizNo] ?? null,
    lastYearSales: sales[s.bizNo] ?? null,
  });

  const vans = [];
  if (kovan) {
    vans.push({
      van: "KOVAN",
      label: "코밴",
      updatedAt: kovan.updatedAt ?? null,
      baseDate: kovan.baseDate ?? null,
      count: kovan.count ?? 0,
      uniqueBizCount: kovan.uniqueBizCount ?? 0,
      stores: (kovan.stores ?? []).map((s) => withStatus(s, "코밴")),
    });
  }
  if (ddwm) {
    vans.push({
      van: "DAOUDATA",
      label: "다우데이타",
      updatedAt: ddwm.updatedAt ?? null,
      baseDate: ddwm.baseDate ?? null,
      count: ddwm.count ?? 0,
      uniqueBizCount: ddwm.uniqueBizCount ?? 0,
      stores: (ddwm.stores ?? []).map((s) => withStatus(s, "다우데이타")),
    });
  }
  const allStores = vans.flatMap((v) => v.stores);
  const closed = allStores.filter((s) => s.status?.b_stt_cd === "03").length;
  return {
    updatedAt: vans.map((v) => v.updatedAt).filter(Boolean).sort().pop() ?? null,
    vans,
    combinedCount: allStores.length,
    combinedUniqueBiz: new Set(allStores.map((s) => s.bizNo)).size,
    statusCheckedAt: statusFile?.checkedAt ?? null,
    closedCount: closed,
    lastYearSalesYear: salesFile?.year ?? null,
    note: vans.length ? undefined : "아직 수집 전 — '지금 동기화' 또는 매일 08:00 자동 수집 후 표시됩니다.",
  };
}

app.get("/api/inactive", async (_req, res) => {
  res.json(await buildInactive());
});

// 국세청 사업자등록 상태조회 (계속/휴업/폐업) — 최대 100건/요청
async function checkBusinessStatus(bizNos) {
  const key = process.env.NTS_API_KEY;
  if (!key)
    throw new Error("NTS_API_KEY(.env)가 필요합니다 — 공공데이터포털 사업자등록상태조회 인증키");
  const uniq = [...new Set(bizNos.map((b) => String(b).replace(/[^0-9]/g, "")).filter((b) => b.length === 10))];
  const url = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(key)}&returnType=JSON`;
  const out = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const batch = uniq.slice(i, i + 100);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b_no: batch }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`국세청 API 오류 ${r.status}: ${t.slice(0, 200)}`);
    }
    const j = await r.json();
    for (const d of j.data ?? []) {
      out[d.b_no] = { b_stt: d.b_stt || "", b_stt_cd: d.b_stt_cd || "", end_dt: d.end_dt || "" };
    }
    console.log(`  국세청 조회 ${Math.min(i + 100, uniq.length)}/${uniq.length}`);
  }
  return out;
}

let checking = false;
app.post("/api/inactive/check", async (_req, res) => {
  if (checking) return res.status(409).json({ error: "이미 조회가 진행 중입니다." });
  checking = true;
  try {
    const data = await buildInactive();
    const bizNos = data.vans.flatMap((v) => v.stores.map((s) => s.bizNo));
    const statuses = await checkBusinessStatus(bizNos);
    await writeFile(
      INACTIVE_STATUS_JSON,
      JSON.stringify({ checkedAt: new Date().toISOString(), statuses }, null, 2)
    );
    res.json(await buildInactive());
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  } finally {
    checking = false;
  }
});

// 수동 동기화 — 스크래퍼 실행 후 결과 반환 (.env 자격증명은 자식이 새로 읽도록 제거)
const CRED_KEYS = [
  "KOVAN_ID", "KOVAN_PW", "KOVAN_AGENCY", "KOVAN_TRAN",
  "DDWM_ID", "DDWM_PW", "GMAIL_USER", "GMAIL_APP_PASSWORD",
];
function freshEnv() {
  const e = { ...process.env };
  for (const k of CRED_KEYS) delete e[k];
  return e;
}
function runScript(scriptName) {
  return new Promise((resolve) => {
    console.log(`▶ 실행: ${scriptName}`);
    const child = spawn(process.execPath, [join(__dirname, scriptName)], {
      cwd: dirname(__dirname),
      env: freshEnv(),
    });
    let stderr = "";
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: 1, stderr: String(e.message) }));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

const syncLocks = {};
async function syncRoute(key, scripts, build, res) {
  if (syncLocks[key]) return res.status(409).json({ error: "이미 동기화가 진행 중입니다." });
  syncLocks[key] = true;
  try {
    const errs = [];
    for (const s of scripts) {
      const r = await runScript(s);
      if (r.code !== 0) errs.push(`${s}: ${(r.stderr.trim().split("\n").pop() || "실패")}`);
    }
    const data = await build();
    if (errs.length) data.syncWarning = errs.join(" | ");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  } finally {
    syncLocks[key] = false;
  }
}

app.post("/api/tr/sync", (_req, res) =>
  syncRoute("tr", ["kovan-tr-scraper.mjs", "ddwm-tr-scraper.mjs"], buildTr, res)
);
app.post("/api/inactive/sync", (_req, res) =>
  syncRoute("inactive", ["kovan-inactive-scraper.mjs", "ddwm-inactive-scraper.mjs"], buildInactive, res)
);

// ===== CS 현황 (담당자별 대기상태 + 일일업무현황) =====
// 현재 목업 — 채널톡(Channel.io) 등 실제 CS 소스 연동 시 csData()만 교체.
const CS_AGENTS = ["김동만", "민승재", "조아름", "김소원"];
const CS_STATUSES = [
  ["available", "대기중"],
  ["busy", "상담중"],
  ["away", "자리비움"],
  ["offline", "오프라인"],
];

// 문자열 시드 → 0~1 (날짜+이름 기준이라 같은 날엔 안정적, 날짜 바뀌면 변동)
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function csDataMock() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const agents = CS_AGENTS.map((name) => {
    const r1 = seeded(day + name);
    const r2 = seeded(name + day + "b");
    const r3 = seeded(name + day + "s");
    const [status, statusLabel] = CS_STATUSES[Math.floor(r3 * CS_STATUSES.length)];
    const ongoing = status === "busy" ? 1 + Math.floor(r2 * 3) : Math.floor(r2 * 2);
    return {
      name,
      status,
      statusLabel,
      ongoing, // 진행 중 상담
      waiting: Math.floor(seeded(name + "w" + day) * 4), // 대기(미응대)
      todayHandled: 6 + Math.floor(r1 * 28), // 오늘 처리
      avgResponseMin: 2 + Math.floor(r2 * 13), // 평균 첫응답(분)
    };
  });
  const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
  return {
    updatedAt: now.toISOString(),
    source: "mock",
    agents,
    summary: {
      waiting: sum("waiting"),
      ongoing: sum("ongoing"),
      todayHandled: sum("todayHandled"),
      avgFirstResponseMin: Math.round(sum("avgResponseMin") / agents.length),
      online: agents.filter((a) => a.status !== "offline").length,
      total: agents.length,
    },
  };
}

// ----- 채널톡(Channel.io) Open API 연동 -----
const CH_BASE = "https://api.channel.io/open/v5";
function chKeys() {
  return { key: process.env.CHANNELTALK_ACCESS_KEY, secret: process.env.CHANNELTALK_ACCESS_SECRET };
}
async function chFetch(path, params = {}) {
  const { key, secret } = chKeys();
  const url = new URL(CH_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  const r = await fetch(url, {
    headers: { "x-access-key": key, "x-access-secret": secret, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`채널톡 API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function chListUserChats(state, stopBeforeMs) {
  const out = [];
  let since;
  do {
    const j = await chFetch("/user-chats", { state, limit: 500, sortOrder: "desc", since });
    const chats = j.userChats ?? [];
    out.push(...chats);
    since = j.next;
    if (stopBeforeMs && chats.length) {
      const oldest = Math.min(...chats.map((c) => c.closedAt ?? c.updatedAt ?? c.createdAt ?? 0));
      if (oldest < stopBeforeMs) break;
    }
    if (!since || out.length >= 10000) break;
  } while (true);
  return out;
}
// 매니저 표시명 정리: "다인아이앤씨_민승재" → 민승재, "다인아이앤씨 조아름" → 조아름
function cleanManagerName(name) {
  const s = (name || "").replace(/^다인아이앤씨/, "").replace(/^[\s_\-]+/, "").trim();
  return s || (name || "").trim();
}

async function csDataFromChannel() {
  const now = new Date();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const ts = todayStart.getTime();

  const managersRes = await chFetch("/managers", { limit: 500 });
  const operators = (managersRes.managers ?? []).filter((m) => m.operator && !m.removed);
  // 지정된 CS 담당자(김동만/민승재/조아름/김소원)만, 없으면 전체 operator
  const matched = operators.filter((m) => CS_AGENTS.includes(cleanManagerName(m.name)));
  const managers = matched.length ? matched : operators;

  // 실시간 접속자 + 운영자 상태(대기 중/채팅 중/다른 업무 중/퇴근 …)
  const onlineSet = new Set(
    (managersRes.onlines ?? []).filter((o) => o.personType === "manager").map((o) => o.personId)
  );
  const statusBy = {};
  for (const s of managersRes.operatorStatuses ?? []) {
    const t = s.operatorStatusType?.type ?? {};
    statusBy[s.managerId] = {
      label: t.nameDescI18nMap?.ko?.name || t.name || "",
      typeValue: t.value,
      stateValue: t.stateValue,
      enable: s.enable,
    };
  }

  const opened = await chListUserChats("opened");
  const closed = await chListUserChats("closed", ts);
  const closedToday = closed.filter((c) => (c.closedAt ?? 0) >= ts);

  const item = (c) => ({
    name: c.name || "(이름 없음)",
    url: `https://desk.channel.io/#/channels/${c.channelId}/user_chats/${c.id}`,
  });

  const agents = managers.map((m) => {
    const mine = opened.filter((c) => c.assigneeId === m.id);
    const ongoing = mine.length;
    const waiting = mine.filter((c) => c.goalState === "waiting").length; // 미응대(고객 대기)
    const todays = closedToday.filter((c) => c.assigneeId === m.id);
    const rts = todays.map((c) => c.resolutionTime).filter((x) => typeof x === "number");
    const avgResolutionMin = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length / 60000) : 0;

    const { code, label } = mapOperatorStatus(statusBy[m.id]);
    return {
      name: cleanManagerName(m.name),
      status: code,
      statusLabel: label, // 채널톡 실제 상태명 그대로
      online: onlineSet.has(m.id),
      ongoing,
      waiting,
      todayHandled: todays.length,
      avgResponseMin: avgResolutionMin,
      // 드릴다운: 숫자 클릭 시 상담 매장 목록
      ongoingChats: mine.map(item),
      waitingChats: mine.filter((c) => c.goalState === "waiting").map(item),
      todayChats: todays.map(item),
    };
  });

  const teamWaiting = opened.filter((c) => c.goalState === "waiting").length;
  const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
  const rtAll = closedToday.map((c) => c.resolutionTime).filter((x) => typeof x === "number");
  return {
    updatedAt: now.toISOString(),
    source: "channeltalk",
    agents,
    summary: {
      waiting: teamWaiting,
      ongoing: sum("ongoing"),
      todayHandled: closedToday.length,
      avgFirstResponseMin: rtAll.length ? Math.round(rtAll.reduce((a, b) => a + b, 0) / rtAll.length / 60000) : 0,
      online: agents.filter((a) => a.online).length,
      total: agents.length,
    },
    // 상단 카드 클릭용 전체 목록 (미배정 포함)
    lists: {
      ongoing: opened.map(item),
      waiting: opened.filter((c) => c.goalState === "waiting").map(item),
      today: closedToday.map(item),
    },
  };
}

// 채널톡 operatorStatus → 대시보드 상태코드(색상) + 실제 한글 라벨
function mapOperatorStatus(op) {
  if (!op || !op.enable) return { code: "offline", label: op?.label || "오프라인" };
  if (op.stateValue === "off") return { code: "offline", label: op.label || "퇴근" };
  if (op.typeValue === "waiting") return { code: "available", label: op.label || "대기 중" };
  if (op.typeValue === "chat" || /채팅|상담/.test(op.label)) return { code: "busy", label: op.label || "채팅 중" };
  return { code: "away", label: op.label || "다른 업무 중" }; // 회의/식사/다른 업무 등 커스텀
}

const CS_STATUS_LABELS = { available: "대기중", busy: "상담중", away: "자리비움", offline: "오프라인" };

// 수동 지정 상태(당일만 유효)를 자동 판정 위에 덮어쓰기 — 채널톡이 '다른 업무중'을 API로 안 줘서 보완
async function applyCsOverrides(data) {
  const ov = await readJson(CS_OVERRIDE_JSON);
  const today = new Date().toISOString().slice(0, 10);
  const map = ov && ov.date === today ? ov.byName ?? {} : {};
  data.agents = data.agents.map((a) => {
    const o = map[a.name];
    if (o && CS_STATUS_LABELS[o]) return { ...a, status: o, statusLabel: CS_STATUS_LABELS[o], manual: true };
    return a;
  });
  return data; // 접속(online) 카운트는 실제 onlines 기반 그대로 유지
}

async function getCs() {
  let data;
  const { key, secret } = chKeys();
  if (!key || !secret) data = { ...csDataMock(), note: "채널톡 키 미설정 — 목업 표시" };
  else {
    try {
      data = await csDataFromChannel();
    } catch (e) {
      console.error("채널톡 조회 실패:", e.message);
      data = { ...csDataMock(), note: `채널톡 조회 실패(목업 표시): ${e.message}` };
    }
  }
  return applyCsOverrides(data);
}

// 오늘 '채팅 인입' 기준 요약 (커스텀 리포트의 채팅 부분과 맞춤) — 전화·ALF는 Open API 미제공
async function csChatSummary() {
  const { key, secret } = chKeys();
  if (!key || !secret) return null;
  const ts = new Date();
  ts.setHours(0, 0, 0, 0);
  const since0 = ts.getTime();
  const managersRes = await chFetch("/managers", { limit: 500 });
  const nameById = {};
  for (const m of managersRes.managers ?? []) nameById[m.id] = cleanManagerName(m.name);
  const chats = await chListUserChats("", since0); // 전체 상태
  const today = chats.filter((c) => (c.createdAt ?? c.openedAt ?? 0) >= since0);
  const byAgent = {};
  let respSum = 0, respN = 0;
  for (const c of today) {
    const who = c.assigneeId ? nameById[c.assigneeId] : null;
    if (who) byAgent[who] = (byAgent[who] || 0) + 1;
    // 첫 응답까지의 시간(ms) — 운영시간 기준 대기시간(리포트 정의에 근접)
    const w = c.operationWaitingTime ?? c.waitingTime;
    if (typeof w === "number" && w > 0) { respSum += w; respN++; }
  }
  return {
    inbound: today.length,
    waiting: today.filter((c) => c.state === "opened" && c.goalState === "waiting").length,
    avgFirstResponseSec: respN ? Math.round(respSum / respN / 1000) : 0,
    byAgent: Object.entries(byAgent).map(([name, handled]) => ({ name, handled })).sort((a, b) => b.handled - a.handled),
  };
}

// ===== 채널톡 일일 리포트(서비스별 비율 + 담당자별) — 전화·채널톡·카카오 전부 API 자동 =====
const CS_REPORT_DIR = join(__dirname, "data", "cs-report");
if (!existsSync(CS_REPORT_DIR)) mkdirSync(CS_REPORT_DIR, { recursive: true });
const csReportPath = (date) => join(CS_REPORT_DIR, `${date}.json`);

// 서비스별(전화/채널톡/카카오) 인입 자동 집계 — 전부 채널톡 Open API에서 계산.
//  전화   = 그날 전체 통화(부재중·아웃바운드 포함), 통화 응대자(lastAssigneeId) 기준
//  채널톡 = native 상담(생성일), 배정자 기준
//  카카오 = appKakao 상담(생성일), 배정자 기준
// (채널톡 자체 리포트의 전화 집계는 내부 로직이라 ±몇 건 오차 가능)
async function csServiceBreakdown(dateIso) {
  const { key, secret } = chKeys();
  if (!key || !secret) return null;
  const [y, m, d] = dateIso.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = start + 24 * 3600 * 1000;

  const managersRes = await chFetch("/managers", { limit: 500 });
  const nameById = {};
  for (const mm of managersRes.managers ?? []) nameById[mm.id] = cleanManagerName(mm.name);

  const opened = await chListUserChats("opened");
  const snoozed = await chListUserChats("snoozed");
  const closed = await chListUserChats("closed", start);
  const seen = new Set();
  const all = [...opened, ...snoozed, ...closed].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  const per = {};
  const tot = { phone: 0, chat: 0, kakao: 0 };
  const bump = (id, k) => {
    const name = id ? nameById[id] : null;
    if (name) {
      per[name] = per[name] || { phone: 0, chat: 0, kakao: 0 };
      per[name][k]++;
    }
    tot[k]++; // 총계(파이)는 미배정 포함 전체
  };

  // 전화: 통화 단위(부재중·아웃바운드 포함), 응대자 기준
  const phoneChats = all.filter(
    (c) => c.source?.medium?.mediumType === "phone" && (c.updatedAt ?? c.createdAt ?? 0) >= start
  );
  for (const c of phoneChats) {
    const calls = await chatCalls(c);
    for (const call of calls) {
      const at = call.at ?? 0;
      if (at < start || at >= end) continue;
      bump(call.assignee, "phone");
    }
  }
  await writeFile(CALL_DETAIL_JSON, JSON.stringify(_callCache ?? {})).catch(() => {});

  // 채널톡 메시지(native) / 카카오(appKakao): 상담 단위(생성일), 배정자 기준
  for (const c of all) {
    const created = c.createdAt ?? 0;
    if (created < start || created >= end) continue;
    if (c.source?.medium?.mediumType === "native") bump(c.assigneeId, "chat");
    else if (c.source?.appMessenger?.mediumType === "appKakao") bump(c.assigneeId, "kakao");
  }

  const rows = CS_AGENTS.map((name) => ({
    name,
    phone: per[name]?.phone || 0,
    chat: per[name]?.chat || 0,
    kakao: per[name]?.kakao || 0,
  }));
  return { rows, totalPhone: tot.phone, totalChat: tot.chat, totalKakao: tot.kakao };
}

const _csBreakCache = {}; // date -> { data, at } (오늘 5분 · 과거 영구 캐시)
app.get("/api/cs-report", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : localDateIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "날짜(YYYY-MM-DD)가 필요합니다." });
    const isToday = date === localDateIso();
    const force = req.query.force === "1";

    const cached = _csBreakCache[date];
    const ttl = isToday ? 5 * 60 * 1000 : Infinity;
    if (!force && cached && Date.now() - cached.at < ttl) return res.json(cached.data);

    if (!force && !isToday) {
      const saved = await readJson(csReportPath(date));
      if (saved && saved.auto) {
        _csBreakCache[date] = { data: saved, at: Date.now() };
        return res.json(saved);
      }
    }

    const b = await csServiceBreakdown(date);
    if (!b) {
      return res.json({
        date,
        rows: CS_AGENTS.map((name) => ({ name, phone: 0, chat: 0, kakao: 0 })),
        totalPhone: 0, totalChat: 0, totalKakao: 0,
        updatedAt: null, auto: true, note: "채널톡 키 미설정",
      });
    }
    const data = {
      date,
      rows: b.rows,
      totalPhone: b.totalPhone,
      totalChat: b.totalChat,
      totalKakao: b.totalKakao,
      updatedAt: new Date().toISOString(),
      auto: true,
    };
    _csBreakCache[date] = { data, at: Date.now() };
    await writeFile(csReportPath(date), JSON.stringify(data, null, 2)).catch(() => {});
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
app.post("/api/cs-report", async (req, res) => {
  try {
    const date = String(req.body?.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "날짜(YYYY-MM-DD)가 필요합니다." });
    const rows = Array.isArray(req.body?.rows)
      ? req.body.rows
          .map((r) => ({ name: String(r.name || "").trim(), phone: Math.max(0, Number(r.phone) || 0), chat: Math.max(0, Number(r.chat) || 0) }))
          .filter((r) => r.name)
      : [];
    const data = {
      date,
      rows,
      totalPhone: Math.max(0, Number(req.body?.totalPhone) || 0),
      totalChat: Math.max(0, Number(req.body?.totalChat) || 0),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(csReportPath(date), JSON.stringify(data, null, 2));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get("/api/cs", async (_req, res) => res.json(await getCs()));
app.post("/api/cs/sync", async (_req, res) => res.json(await getCs()));

// ===== 전화 인입 현황 (요일×시간 히트맵) =====
// 전화 인입 = userChat source.medium.mediumType === "phone".
// 채널톡이 '걸려온 번호'는 저장 안 함 → 워크플로우(콜 라인)로 구분.
// 번호 매핑이 확인되면 라벨만 교체.
// 브랜드 구분: ① 상담 태그(다인아이앤씨/* vs 아무도없개/*) 우선, ② 없으면 전화 워크플로우(콜 라인)로 보완
function brandOf(c) {
  for (const t of c.tags ?? []) {
    if (t.startsWith("다인아이앤씨")) return "dain";
    if (t.startsWith("아무도없개")) return "amudo";
  }
  const wf = c.source?.workflow?.id;
  if (wf === "746133") return "dain";
  if (wf === "750171") return "amudo";
  return null;
}
const blankGrid = () => Array.from({ length: 7 }, () => Array(24).fill(0));

// 우리 전화 라인 → 브랜드 (인바운드 통화의 call.to = 걸려온 라인)
const LINE_BRAND = {
  "+827041383896": "dain", // 70-4138-3896 = 다인아이앤씨
  "+827041383893": "amudo", // 70-4138-3893 = 아무도없개
};

// 통화 상세 캐시: 상담별 call 목록 추출(메시지의 meet.call). 종료(closed) 상담은 불변이라 영구 캐시.
const CALL_DETAIL_JSON = join(__dirname, "data", "call-detail.json");
let _callCache = null;
const CALL_CACHE_V = 2; // 통화 객체에 assignee/callState/engaged 추가 → 캐시 버전업
async function chatCalls(chat) {
  if (!_callCache) _callCache = (await readJson(CALL_DETAIL_JSON)) || {};
  const hit = _callCache[chat.id];
  if (hit && hit.state === "closed" && hit.v === CALL_CACHE_V) return hit.calls; // 종료 상담은 캐시 재사용
  try {
    const j = await chFetch(`/user-chats/${chat.id}/messages`, { limit: 50, sortOrder: "asc" });
    const calls = [];
    for (const m of j.messages ?? []) {
      const cl = m.meet?.call;
      if (cl && cl.direction)
        calls.push({
          dir: cl.direction,
          to: cl.to,
          from: cl.from,
          at: cl.createAt || m.createdAt,
          assignee: cl.lastAssigneeId ?? chat.assigneeId ?? null, // 그 통화 응대자
          callState: cl.state ?? null, // "ended" | "missed" 등
          engaged: !!cl.engagedAt, // 실제 연결(응대)됨
        });
    }
    _callCache[chat.id] = { state: chat.state, v: CALL_CACHE_V, calls };
    return calls;
  } catch {
    return hit?.calls ?? [];
  }
}

// 채널톡은 '통화(call)' 단위로 집계(한 상담에 통화 여러 건 가능). 전화=통화 단위, 채팅=상담 단위.
async function callsData(days = 7) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.getTime() - (days - 1) * 24 * 3600 * 1000;
  const { key, secret } = chKeys();
  if (!key || !secret)
    return { updatedAt: new Date().toISOString(), source: "none", days, series: [], note: "채널톡 키 미설정" };

  const opened = await chListUserChats("opened");
  const snoozed = await chListUserChats("snoozed");
  const closed = await chListUserChats("closed", since);
  const seen = new Set();
  const allChats = [...opened, ...snoozed, ...closed].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  const phoneChats = allChats.filter((c) => c.source?.medium?.mediumType === "phone");
  const textChats = allChats.filter(
    (c) => c.source?.medium?.mediumType !== "phone" && (c.createdAt ?? 0) >= since
  );

  const mk = (label) => ({ label, grid: blankGrid(), total: 0, items: [] });
  const S = {
    all: mk("전체"),
    phoneIn: mk("전화(인바운드)"),
    phoneOut: mk("전화(아웃바운드)"),
    chat: mk("채팅"),
    dain: mk("다인아이앤씨"), amudo: mk("아무도없개"),
  };
  const add = (k, at, it) => {
    const d = new Date(at);
    S[k].grid[d.getDay()][d.getHours()]++;
    S[k].total++;
    S[k].items.push(it);
  };

  // 전화: 통화 단위
  for (const c of phoneChats) {
    const calls = await chatCalls(c);
    for (const call of calls) {
      if ((call.at ?? 0) < since) continue;
      const isIn = call.dir === "inbound";
      const url = `https://desk.channel.io/#/channels/${c.channelId}/user_chats/${c.id}`;
      const it = {
        name: c.name || "(이름 없음)",
        url,
        medium: isIn ? "전화(인바운드)" : "전화(아웃바운드)",
        tags: (c.tags ?? []).join(", "),
        at: call.at,
      };
      if (isIn) {
        add("all", call.at, it); // 인입(전체)엔 인바운드만
        add("phoneIn", call.at, it);
        const brand = LINE_BRAND[call.to];
        if (brand) add(brand, call.at, it); // 라인번호로 브랜드
      } else {
        add("phoneOut", call.at, it);
      }
    }
  }
  await writeFile(CALL_DETAIL_JSON, JSON.stringify(_callCache ?? {})).catch(() => {});

  // 채팅: 상담 단위
  for (const c of textChats) {
    const it = {
      name: c.name || "(이름 없음)",
      url: `https://desk.channel.io/#/channels/${c.channelId}/user_chats/${c.id}`,
      medium: "채팅",
      tags: (c.tags ?? []).join(", "),
      at: c.createdAt,
    };
    add("all", c.createdAt, it);
    add("chat", c.createdAt, it);
    add("dain", c.createdAt, it); // 채팅은 모두 다인아이앤씨로 (태그는 기준에서 제외)
  }

  const flat = (g) => Math.max(0, ...g.flat());
  const series = ["all", "phoneIn", "phoneOut", "chat", "dain", "amudo"].map((id) => ({
    id,
    label: S[id].label,
    total: S[id].total,
    grid: S[id].grid,
    max: flat(S[id].grid),
    items: S[id].items.sort((a, b) => b.at - a.at).slice(0, 500),
  }));

  return { updatedAt: new Date().toISOString(), source: "channeltalk", days, series };
}

app.get("/api/calls", async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    res.json(await callsData(days));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 담당자 상태 수동 지정 ({ name, status }) — status: available|busy|away|offline|auto(해제)
app.post("/api/cs/status", async (req, res) => {
  try {
    const { name, status } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name 필요" });
    const today = new Date().toISOString().slice(0, 10);
    let ov = await readJson(CS_OVERRIDE_JSON);
    if (!ov || ov.date !== today) ov = { date: today, byName: {} };
    if (!status || status === "auto") delete ov.byName[name];
    else if (CS_STATUS_LABELS[status]) ov.byName[name] = status;
    else return res.status(400).json({ error: "잘못된 status" });
    await writeFile(CS_OVERRIDE_JSON, JSON.stringify(ov, null, 2));
    res.json(await getCs());
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 실제 필드 확인용 디버그 (키 설정 시): 매니저/유저챗 샘플 원본
app.get("/api/cs/debug", async (_req, res) => {
  try {
    const m = await chFetch("/managers", { limit: 3 });
    const oc = await chFetch("/user-chats", { state: "opened", limit: 2 });
    const cc = await chFetch("/user-chats", { state: "closed", limit: 2 });
    res.json({
      managerSample: (m.managers ?? [])[0] ?? null,
      managerNames: (m.managers ?? []).map((x) => x.name),
      openedSample: (oc.userChats ?? [])[0] ?? null,
      closedSample: (cc.userChats ?? [])[0] ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ===== 꿀팁게시판 (가이드 Q&A / 의사결정 트리) =====
const PLAYBOOK_SEED = {
  playbooks: [
    {
      id: "seed-card",
      title: "카드 결제가 안 돼요",
      category: "결제",
      rootId: "n1",
      nodes: {
        n1: { id: "n1", text: "어떤 증상인가요?", options: [
          { label: "카드 단말기에서 오류 메시지가 뜸", next: "n2" },
          { label: "특정 카드사만 안 됨", next: "n3" },
          { label: "전체 결제가 안 됨", next: "n4" },
        ]},
        n2: { id: "n2", text: "오류 메시지 코드를 확인하세요. 단말기 재부팅 후 재시도 안내. 그래도 안 되면 VAN사 점검 필요(거래내역에서 단말기 상태 확인).", answer: true },
        n3: { id: "n3", text: "해당 카드사 점검/한도 문제일 수 있습니다. 다른 카드로 결제 유도 후, 지속되면 카드사 가맹점 등록 상태 확인.", answer: true },
        n4: { id: "n4", text: "통신/전원 확인 → 단말기 재부팅 → VAN 통신장애 여부 확인. 장애 시 공지 안내 후 수기전표 안내.", answer: true },
      },
    },
  ],
};

app.get("/api/playbooks", async (_req, res) => {
  res.json((await readJson(PLAYBOOKS_JSON)) ?? PLAYBOOK_SEED);
});

app.put("/api/playbooks", async (req, res) => {
  try {
    const body = req.body;
    if (!body || !Array.isArray(body.playbooks)) return res.status(400).json({ error: "playbooks 배열 필요" });
    await writeFile(PLAYBOOKS_JSON, JSON.stringify(body, null, 2));
    res.json(body);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Claude(JSON) 호출
async function claudeText(system, user, maxTokens = 6000) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY(.env)가 필요합니다 — AI 초안 생성용");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.content ?? []).map((b) => b.text || "").join("");
}

// ===== 네이버 블로그 게시글 검사기 (Claude) =====
const BLOG_MODELS = {
  "claude-sonnet-4-6": { priceIn: 3, priceOut: 15 },
  "claude-haiku-4-5": { priceIn: 1, priceOut: 5 },
  "claude-opus-4-8": { priceIn: 5, priceOut: 25 },
};
const BLOG_DEFAULT_MODEL = "claude-sonnet-4-6";
const BLOG_ALLOWED_IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const BLOG_SYSTEM = `당신은 네이버 블로그 검색 노출(SEO) 최적화 전문가입니다.
사용자가 작성한 블로그 글(제목 + 본문)을 분석해서, 네이버 검색 결과에 더 잘 노출되도록
무엇이 잘못됐고 어떻게 고쳐야 하는지 구체적으로 피드백하세요.

평가 시 다음 네이버 블로그 노출 기준을 고려하세요:
- 제목에 핵심 키워드가 자연스럽게 포함됐는가
- 본문 글자 수가 충분한가 (보통 1,000자 이상 권장)
- 핵심 키워드가 본문에 적절히 반복되는가 (너무 적어도, 너무 과해도(키워드 스터핑) 감점)
- 소제목/문단 구조로 가독성이 좋은가
- 도입부가 검색 의도에 빠르게 답하는가 (체류시간 유도)
- 유사·중복 문서: 다른 블로그에서 그대로 복사한 문장이 있는가. 단, 소제목 활용·단락 구조·키워드 배치가 잘 된 글은 "뻔하다"고 평가하지 말 것. 문단 구조가 정돈되고 키워드가 자연스럽게 들어간 글은 오히려 SEO에 유리하므로 가점 요인으로 본다.
- 이미지/동영상 활용: 이미지 관련 평가·제안은 "첨부 이미지가 있을 때만" 합니다. 첨부 이미지가 있으면 본문 주제와 잘 맞는지·직접 찍은 사진처럼 보이는지 보고, 배치 위치를 제안할 때는 반드시 첨부된 파일명으로 지칭하세요. 첨부 이미지가 없으면 이미지·사진에 대한 언급을 전혀 하지 마세요.
- 해시태그/연관 키워드 활용

점수 판정 기준 (overallScore):
- 위 항목 중 대부분(5개 이상)이 충족되면 80점 이상을 부여하세요.
- 제목 키워드 포함 + 1,000자 이상 + 소제목 구조 + 키워드 자연 배치 + 해시태그가 모두 갖춰진 글은 최소 85점 이상입니다.
- "AI가 작성한 것 같다"거나 "표현이 매끄럽다"는 이유로 감점하지 마세요. SEO 기준으로만 판단하세요.

피드백은 한국어로, 초보 블로거도 이해할 수 있게 친절하지만 솔직하게 작성하세요.
실제로 고칠 수 있는 행동 중심의 조언을 주세요. 막연한 칭찬은 피하세요.
이미 잘 최적화된 글에는 "이미 잘 작성된 글입니다"라고 인정하고, 남은 소소한 개선점만 짚어주세요.

마지막으로, 위 피드백을 모두 반영한 "개선된 전체 글"을 작성하세요:
- improvedTitle: 노출에 유리하게 다듬은 제목 (핵심 키워드 포함)
- improvedBody: 그대로 복사해 네이버 블로그에 붙여넣을 수 있는 완성된 본문.
  · 사용자가 쓴 실제 경험·사실은 유지하되, 지어내지 말 것 (없는 정보는 [여기에 OO 정보 추가] 처럼 빈칸으로 안내)
  · 분량을 충분히 늘리고(가능하면 1,000자 이상), 소제목과 문단으로 구조화
  · 핵심 키워드와 연관 키워드를 자연스럽게 배치 (키워드 스터핑 금지)
  · 첨부 이미지가 있을 때만, 그 사진을 넣으면 좋은 위치를 본문 안에 (사진: 파일명) 형식으로 표시. 첨부 이미지가 없으면 본문에 사진 관련 표시를 넣지 말 것
  · 글 끝에 어울리는 해시태그 5~10개 제안
  · 반드시 순수 텍스트로만 작성할 것: 마크다운(**, *, #) 및 HTML 태그 절대 사용 금지. 소제목은 빈 줄 후 일반 텍스트로, 강조가 필요하면 ■ ▶ 【】 같은 특수문자 활용.

반드시 아래 JSON 형식으로만 응답하세요. 코드 블록이나 설명 텍스트 없이 순수 JSON 객체만 출력하세요:
{
  "overallScore": <정수 0-100>,
  "summary": "<노출 가능성 총평 2-3문장>",
  "mainKeyword": "<이 글의 핵심 키워드>",
  "titleFeedback": { "score": <정수 0-100>, "comment": "<제목 피드백>" },
  "issues": [{ "severity": "high|medium|low", "location": "<위치>", "problem": "<문제>", "suggestion": "<개선안>" }],
  "strengths": ["<잘한 점>"],
  "rewrittenTitleSuggestions": ["<대안 제목>"],
  "improvedTitle": "<개선 제목>",
  "improvedBody": "<개선 본문>"
}`;

app.post("/api/blog-analyze", async (req, res) => {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key)
      return res.status(500).json({ error: "ANTHROPIC_API_KEY(.env)가 설정되지 않았습니다." });

    const { title, body, model, kioskModel } = req.body ?? {};
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!body || typeof body !== "string" || body.trim().length < 10)
      return res.status(400).json({ error: "본문 내용을 10자 이상 입력해 주세요." });

    const validImages = images
      .filter(
        (im) =>
          im &&
          BLOG_ALLOWED_IMG.includes(im.mediaType) &&
          typeof im.data === "string" &&
          im.data.length > 0
      )
      .slice(0, 6);

    const modelId = BLOG_MODELS[model] ? model : BLOG_DEFAULT_MODEL;
    const cfg = BLOG_MODELS[modelId];

    let imageNote;
    if (validImages.length > 0) {
      const names = validImages.map((im, i) => im.name || `이미지${i + 1}`).join(", ");
      imageNote = `\n\n[첨부 이미지] ${validImages.length}장: ${names}\n이미지 배치를 제안할 때는 반드시 위 파일명으로 지칭하세요. 첨부된 적 없는 이미지를 지어내지 마세요.`;
    } else {
      imageNote = `\n\n[첨부 이미지] 없음 — 이미지·사진에 대한 평가나 제안을 일절 하지 마세요.`;
    }
    const kioskNote = kioskModel
      ? `\n\n[키오스크 모델명] ${kioskModel} — improvedBody에 이 모델명을 자연스럽게 포함하세요.`
      : "";

    const userContent = [
      {
        type: "text",
        text: `다음 네이버 블로그 글을 분석해 주세요.${imageNote}${kioskNote}\n\n[제목]\n${
          title || "(제목 없음)"
        }\n\n[본문]\n${body}`,
      },
      ...validImages.map((im) => ({
        type: "image",
        source: { type: "base64", media_type: im.mediaType, data: im.data },
      })),
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 8192,
        system: BLOG_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `Claude API ${r.status}`);

    let text = (j.content ?? []).map((b) => b.text || "").join("");
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const result = JSON.parse(text);
    result.usedModel = modelId;

    const inTok = j.usage?.input_tokens || 0;
    const outTok = j.usage?.output_tokens || 0;
    const usd = (inTok * cfg.priceIn + outTok * cfg.priceOut) / 1_000_000;
    result.cost = {
      inputTokens: inTok,
      outputTokens: outTok,
      usd,
      krw: Math.round(usd * 1400),
    };

    res.json(result);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/quota|rate|429|overloaded/i.test(msg))
      return res.status(429).json({ error: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요." });
    if (msg.includes("JSON"))
      return res.status(502).json({ error: "분석 결과 형식이 올바르지 않습니다. 다시 시도해 주세요." });
    res.status(500).json({ error: msg.slice(0, 200) });
  }
});

// 사진 업로드 (base64 → 파일 저장 → URL 반환). 꿀팁게시판 첨부용.
app.post("/api/upload", async (req, res) => {
  try {
    const { name, mediaType, data } = req.body ?? {};
    if (!data || typeof data !== "string")
      return res.status(400).json({ error: "파일 데이터가 없습니다." });
    const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
    const ext = EXT[mediaType];
    if (!ext) return res.status(400).json({ error: "지원하지 않는 이미지 형식입니다(jpg/png/gif/webp)." });
    const buf = Buffer.from(data, "base64");
    if (buf.length > 10 * 1024 * 1024)
      return res.status(413).json({ error: "사진은 10MB 이하만 가능합니다." });
    const safe = String(name || "img")
      .replace(/\.[^.]+$/, "") // 기존 확장자 제거(중복 방지)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-40) || "img";
    const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}.${ext}`;
    await writeFile(join(UPLOADS_DIR, file), buf);
    res.json({ url: `/api/uploads/${file}` });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 채널톡 closed 상담의 '첫 문의 내용'을 표본으로 수집.
// 태그를 거의 안 다는 환경이므로, 주제 분류는 태그가 아니라 AI가 '내용'을 읽고 직접 한다.
async function gatherSamples({ days = 60, limit = 100 } = {}) {
  const chats = await chListUserChats("closed", Date.now() - days * 24 * 3600 * 1000);
  const samples = [];
  for (const c of chats.slice(0, limit)) {
    try {
      const m = await chFetch(`/user-chats/${c.id}/messages`, { limit: 4, sortOrder: "asc" });
      const txt = (m.messages ?? []).map((x) => x.plainText).find((t) => t && t.trim());
      if (txt) {
        const tag = (c.tags ?? []).filter(Boolean).join(",");
        samples.push((tag ? `[${tag}] ` : "") + txt.replace(/\s+/g, " ").slice(0, 200));
      }
    } catch {}
  }
  return { totalChats: chats.length, sampled: samples.length, days, samples };
}

app.post("/api/playbooks/generate", async (req, res) => {
  try {
    const days = Math.min(180, Math.max(7, Number(req.body?.days) || 60));
    const limit = Math.min(200, Math.max(20, Number(req.body?.limit) || 100));
    const { totalChats, sampled, samples } = await gatherSamples({ days, limit });
    if (!sampled) return res.status(400).json({ error: "상담 이력을 가져오지 못했습니다." });

    const pbSchema =
      '{"title":"문의 유형 제목","category":"분류(결제/단말기/가맹점/정산/기타)","rootId":"n1","nodes":{"n1":{"id":"n1","text":"질문 또는 확인사항","options":[{"label":"선택지 텍스트","next":"n2"}]},"n2":{"id":"n2","text":"해결책/안내 문구","answer":true}}}';
    const system =
      "너는 고객상담(CS) 지식베이스 설계자다. 상담원이 태그를 거의 달지 않으므로, 주어진 '실제 상담 문의 내용'을 직접 읽고 비슷한 내용끼리 주제로 묶어라. (1) 표본을 주제별로 분류해 각 주제의 건수를 세고, (2) 자주 반복되는 주제(상위 3~6개)에 대해, 상담원이 선택지를 단계별로 클릭하며 따라가 '해결책'에 도달하는 의사결정 트리(플레이북)를 한국어로 만든다. 1~2건짜리 일회성 주제는 제외한다. 각 플레이북은 root 질문에서 시작해 2~4단계 깊이로, 마지막은 answer(해결책) 노드로 끝낸다. 반드시 아래 JSON 객체만 출력하고 코드펜스·설명은 쓰지 마라.";
    const user =
      `다음은 최근 ${days}일 상담 중 ${sampled}건의 첫 문의 내용이다(대괄호 안은 태그가 있으면 참고용, 없으면 내용으로 직접 분류).\n` +
      samples.map((s, i) => `${i + 1}. ${s}`).join("\n") +
      `\n\n출력 스키마(JSON 객체):\n{"topics":[{"name":"주제명","count":건수}], "playbooks":[${pbSchema}]}`;

    let txt = await claudeText(system, user, 8000);
    txt = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(txt);
    const arr = Array.isArray(parsed) ? parsed : parsed.playbooks ?? [];
    const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
    const ts = Date.now();
    const generated = arr.map((p, i) => ({ ...p, id: `ai-${ts}-${i}`, ai: true }));

    const cur = (await readJson(PLAYBOOKS_JSON)) ?? PLAYBOOK_SEED;
    const next = { playbooks: [...generated, ...cur.playbooks] };
    await writeFile(PLAYBOOKS_JSON, JSON.stringify(next, null, 2));
    res.json({
      added: generated.length,
      data: next,
      basis: {
        days,
        totalChats,
        sampled,
        topics: topics.map((t) => ({ tag: t.name, count: t.count })),
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ===== 상담 기록 검색 (인덱스 + AI 원포인트 답변) =====

// 인덱스 메타 조회
app.get("/api/cs-index", async (_req, res) => {
  const idx = await readJson(CS_INDEX_JSON);
  if (!idx) return res.json({ exists: false });
  res.json({
    exists: true,
    lastBuilt: idx.lastBuilt,
    from: idx.from ?? null, // 수집한 기간(시작)
    to: idx.to ?? null, // 수집한 기간(끝)
    count: idx.count,
  });
});

// 인덱스 수집 — 지정 기간(from~to)의 closed 상담 대화를 모아 저장.
// 중복 수집 방지: 이미 인덱스에 있는 상담(id)은 다시 가져오지 않고, 신규만 병합한다.
app.post("/api/cs-index/refresh", async (req, res) => {
  try {
    // 기간 결정: from/to(YYYY-MM-DD) 우선, 없으면 days(기본 90일)
    const toMs = req.body?.to ? Date.parse(`${req.body.to}T23:59:59`) : Date.now();
    let fromMs;
    if (req.body?.from) fromMs = Date.parse(`${req.body.from}T00:00:00`);
    else {
      const days = Math.min(365, Math.max(1, Number(req.body?.days) || 90));
      fromMs = Date.now() - days * 24 * 3600 * 1000;
    }
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs)
      return res.status(400).json({ error: "기간이 올바르지 않습니다. 시작일·종료일을 확인하세요." });
    const limit = Math.min(3000, Math.max(50, Number(req.body?.limit) || 1000));

    // 기존 인덱스 로드 → 이미 모은 상담 id 집합(중복 수집 방지용)
    const prev = await readJson(CS_INDEX_JSON);
    const prevRecords = Array.isArray(prev?.records) ? prev.records : [];
    const haveIds = new Set(prevRecords.map((r) => r.id));

    // 기간 안([from,to])에 종료된 상담만, 그리고 아직 안 모은(신규) 것만
    const chats = await chListUserChats("closed", fromMs);
    const inRange = chats.filter((c) => {
      const t = c.closedAt ?? c.updatedAt ?? c.createdAt ?? 0;
      return t >= fromMs && t <= toMs;
    });
    const freshChats = inRange.filter((c) => !haveIds.has(c.id));
    const skipped = inRange.length - freshChats.length; // 중복으로 건너뛴 수
    const target = freshChats.slice(0, limit);
    const truncated = freshChats.length - target.length; // 한도 초과로 못 모은 수

    const added = [];
    for (const c of target) {
      try {
        const m = await chFetch(`/user-chats/${c.id}/messages`, { limit: 30, sortOrder: "asc" });
        const lines = (m.messages ?? [])
          .filter((x) => x.plainText && x.plainText.trim())
          .map((x) => {
            const role =
              x.personType === "manager" ? "상담원" : x.personType === "bot" ? "봇" : "고객";
            return `${role}: ${x.plainText.replace(/\s+/g, " ").trim()}`;
          });
        if (!lines.length) continue;
        const date = c.closedAt ?? c.updatedAt ?? c.createdAt ?? null;
        added.push({
          id: c.id,
          date: date ? new Date(date).toISOString() : null,
          tags: (c.tags ?? []).filter(Boolean),
          name: c.name ?? null,
          text: lines.join("\n").slice(0, 1200),
          url: c.channelId
            ? `https://desk.channel.io/#/channels/${c.channelId}/user_chats/${c.id}`
            : null,
        });
      } catch {}
    }

    // 병합(신규 + 기존) → id 중복 제거 → 최신순 정렬
    const seen = new Set();
    const records = [...added, ...prevRecords].filter((r) =>
      seen.has(r.id) ? false : seen.add(r.id)
    );
    records.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    // 수집 기간(누적): 이전에 모은 범위와 이번 범위를 합쳐 보관
    const fromISO = new Date(fromMs).toISOString();
    const toISO = new Date(toMs).toISOString();
    const index = {
      lastBuilt: new Date().toISOString(),
      from: prev?.from && prev.from < fromISO ? prev.from : fromISO,
      to: prev?.to && prev.to > toISO ? prev.to : toISO,
      count: records.length,
      records,
    };
    await writeFile(CS_INDEX_JSON, JSON.stringify(index));
    res.json({
      exists: true,
      lastBuilt: index.lastBuilt,
      from: index.from,
      to: index.to,
      count: records.length,
      added: added.length, // 이번에 새로 모은 건수
      skipped, // 이미 있어 건너뛴 건수(중복 방지)
      inRange: inRange.length, // 기간 안 종료 상담 총수
      truncated, // 한도 초과로 이번에 못 모은 신규 건수
      range: { from: req.body?.from ?? fromISO.slice(0, 10), to: req.body?.to ?? toISO.slice(0, 10) },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 검색 — 인덱스에서 키워드로 후보를 추리고 Claude가 원포인트 답변을 정리
app.post("/api/cs-search", async (req, res) => {
  try {
    const query = String(req.body?.query ?? "").trim();
    if (query.length < 2) return res.status(400).json({ error: "검색어를 2자 이상 입력하세요." });
    const idx = await readJson(CS_INDEX_JSON);
    if (!idx || !idx.records?.length)
      return res
        .status(400)
        .json({ error: "상담 인덱스가 없습니다. 먼저 '인덱스 새로고침'으로 상담 기록을 모아주세요." });

    // 한국어 조사·띄어쓰기에 강하도록 '글자 2-gram' 겹침으로 점수화
    const norm = (s) => (s || "").toLowerCase();
    const grams = (s) => {
      const t = norm(s).replace(/\s+/g, "");
      const g = new Set();
      for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
      return [...g];
    };
    const qg = grams(query);
    const qtok = query.split(/\s+/).map(norm).filter((t) => t.length >= 2);
    const scored = idx.records
      .map((r) => {
        const hay = norm(r.text + " " + (r.tags || []).join(" "));
        let score = 0;
        for (const g of qg) if (hay.includes(g)) score += 1; // 글자 2-gram 겹침
        for (const t of qtok) if (hay.includes(t)) score += 2; // 단어 일치 가점
        return { r, score };
      })
      .filter((x) => x.score >= 2) // 최소 2-gram 2개 이상 겹쳐야 후보
      .sort((a, b) => b.score - a.score);

    const top = scored.slice(0, 20).map((x) => x.r);
    if (!top.length)
      return res.json({
        query,
        answer: "",
        confidence: "none",
        sources: [],
        note: "관련 상담 기록을 찾지 못했습니다. 다른 검색어로 시도해 보세요.",
      });

    const system =
      "너는 CS 상담 보조다. 사용자의 질문과 '과거 실제 상담 기록'을 받아, 상담원이 바로 쓸 수 있는 '원포인트 답변'을 한국어로 정리한다. 기록에서 실제로 어떻게 해결됐는지 패턴을 찾아 핵심 해결책을 제시하되, 기록에 근거가 부족하면 솔직히 말하고 지어내지 마라. 반드시 아래 JSON 객체만 출력하고 코드펜스·설명은 쓰지 마라.";
    const user =
      `질문: ${query}\n\n관련 과거 상담 기록 ${top.length}건:\n` +
      top
        .map(
          (r, i) =>
            `[${i + 1}] (${r.date ? r.date.slice(0, 10) : ""}${
              r.tags?.length ? " / " + r.tags.join(",") : ""
            })\n${r.text}`
        )
        .join("\n\n") +
      `\n\n위 기록을 근거로 원포인트 답변을 정리하라. 출력 JSON:\n{"answer":"핵심 해결책(2~5줄, 줄바꿈은 \\n)","steps":["확인/조치 단계(선택)"],"confidence":"high|medium|low","usedSources":[참고한 기록 번호]}`;

    let txt = await claudeText(system, user, 2000);
    txt = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    let ai;
    try {
      ai = JSON.parse(txt);
    } catch {
      ai = { answer: txt, steps: [], confidence: "low", usedSources: [] };
    }
    const used = new Set((ai.usedSources || []).map((n) => Number(n)));
    const sources = top.map((r, i) => ({ ...r, used: used.has(i + 1) }));
    res.json({
      query,
      answer: ai.answer || "",
      steps: Array.isArray(ai.steps) ? ai.steps : [],
      confidence: ai.confidence || "medium",
      sources,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ===== 업무현황 (노션 [업무 DB]) =====
// "업무현황" 페이지 내부 [업무 DB] 데이터소스. (환경변수 NOTION_TASKS_DS_ID 로 덮어쓰기 가능)
const TASKS_DS_ID =
  process.env.NOTION_TASKS_DS_ID || "26ea252e-5579-8384-b9ea-87b2b38f38a3";

// 노션 속성 → 평탄한 TaskRecord 로 정규화해서 프론트로 내려준다.
const plain = (arr) => (arr ?? []).map((t) => t.plain_text).join("");
function taskValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case "title":
      return plain(prop.title);
    case "rich_text":
      return plain(prop.rich_text);
    case "status":
      return prop.status?.name ?? null;
    case "select":
      return prop.select?.name ?? null;
    case "multi_select":
      return prop.multi_select.map((o) => o.name);
    case "date":
      return prop.date?.start ?? null;
    case "created_time":
      return prop.created_time ?? null;
    case "last_edited_time":
      return prop.last_edited_time ?? null;
    case "formula":
      return prop.formula?.[prop.formula?.type] ?? null;
    case "relation":
      return (prop.relation ?? []).map((r) => r.id);
    case "rollup": {
      const a = prop.rollup?.array ?? [];
      const names = a
        .map((x) => (x.type === "select" ? x.select?.name : x.type === "title" ? plain(x.title) : null))
        .filter(Boolean);
      return names;
    }
    default:
      return null;
  }
}

function normalizeTask(page) {
  const p = page.properties ?? {};
  const v = (name) => taskValue(p[name]);
  const roles = v("담당자직책") || [];
  const trashFlag = v("휴지통");
  const staleFlag = v("정체플래그");
  return {
    id: page.id,
    url: page.url,
    name: v("업무명") || "(제목 없음)",
    status: v("상태") || "업무대기",
    assignee: v("담당자T") || (v("담당자명") || [])[0] || "미지정",
    role: roles[0] || null,
    priority: v("우선순위") || null,
    depts: v("연관부서") || [],
    content: v("업무내용") || "",
    collabIds: v("협업자") || [],
    requesterIds: v("요청자") || [],
    category: v("업무분류") || null,
    taskDate: v("업무일자"),
    startDate: v("진행시작일"),
    doneDate: v("완료일"),
    lastStatusChange: v("마지막상태변경일"),
    lastEdited: v("마지막변경시각"),
    created: v("생성일"),
    stale: typeof staleFlag === "string" ? staleFlag.trim() !== "" : Boolean(staleFlag),
    trash: typeof trashFlag === "string" ? trashFlag.trim() !== "" : Boolean(trashFlag),
  };
}

// 직원 DB (pageId → 이름) — 협업자·요청자 관계를 이름으로 풀기 위함
const STAFF_DS_ID = "4c6a252e-5579-83ef-ad91-87cf9084180a";
let staffCache = { at: 0, map: null };
async function loadStaffMap() {
  const now = Date.now();
  if (staffCache.map && now - staffCache.at < 5 * 60 * 1000) return staffCache.map;
  const map = {};
  let cursor;
  do {
    const res = await notion.dataSources.query({ data_source_id: STAFF_DS_ID, start_cursor: cursor, page_size: 100 });
    for (const pg of res.results) {
      let name = "";
      for (const val of Object.values(pg.properties ?? {})) if (val.type === "title") { name = plain(val.title); break; }
      if (name) map[pg.id] = name;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  staffCache = { at: now, map };
  return map;
}
// 업무분류 → 외부 상대(그래프 외부 노드)
const EXT_MAP = {
  "카드사 신청업무": "카드사",
  "가맹점 및 상품등록 업무": "카드사",
  "채널톡 CS응대": "채널톡 고객",
  "효성CMS": "효성",
  "QVAN 업무": "VAN사",
};

async function loadTasks() {
  const tasks = [];
  let cursor;
  do {
    const res = await notion.dataSources.query({
      data_source_id: TASKS_DS_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const t = normalizeTask(page);
      if (t.trash || t.status === "휴지통") continue; // 휴지통 제외
      tasks.push(t);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  // 관계형(협업자·요청자) id → 이름 해석 + 외부 상대 매핑
  const staff = await loadStaffMap();
  for (const t of tasks) {
    t.collab = (t.collabIds || []).map((id) => staff[id]).filter(Boolean).filter((n) => n !== t.assignee);
    t.requester = (t.requesterIds || []).map((id) => staff[id]).filter(Boolean)[0] || null;
    t.ext = EXT_MAP[t.category] ? [EXT_MAP[t.category]] : [];
    delete t.collabIds;
    delete t.requesterIds;
  }
  console.log(`  · 업무 DB: ${tasks.length}건`);
  return tasks;
}

// ===== 내근/외근 상태 (ERP에서 직접 변경, JSON 저장) =====
const STAFF_LOC_JSON = join(__dirname, "data", "staff-location.json");
app.get("/api/staff-location", async (_req, res) => {
  const j = await readJson(STAFF_LOC_JSON);
  res.json(j?.locations || {});
});
app.post("/api/staff-location", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const location = String(req.body?.location || "").trim();
  if (!name || !["내근", "외근"].includes(location))
    return res.status(400).json({ error: "name 과 location(내근|외근) 이 필요합니다." });
  const j = (await readJson(STAFF_LOC_JSON)) || { locations: {} };
  j.locations = j.locations || {};
  j.locations[name] = location;
  await writeFile(STAFF_LOC_JSON, JSON.stringify(j, null, 2));
  res.json({ ok: true, locations: j.locations });
});

let tasksCache = { at: 0, data: null };
app.get("/api/tasks", async (_req, res) => {
  try {
    const now = Date.now();
    if (!tasksCache.data || now - tasksCache.at > TTL_MS) {
      console.log("노션 업무 조회…");
      tasksCache = { at: now, data: await loadTasks() };
    }
    res.json({ updatedAt: new Date(tasksCache.at).toISOString(), tasks: tasksCache.data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ===== 업무일지 (매일 18:00 자동 생성 + 수동) =====
const WORKLOG_HOUR = 19; // 오후 7시

function localDateIso(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const worklogPath = (date) => join(WORKLOGS_DIR, `${date}.json`);

let worklogGenerating = false;
// 하루치 업무일지 생성 → 저장 → 반환. (auto: 스케줄러 자동생성 여부)
async function generateWorklog({ auto = false } = {}) {
  if (worklogGenerating) return null;
  worklogGenerating = true;
  try {
    const date = localDateIso();
    // 직원이 직접 쓴 자유기입(note)은 재생성 시에도 보존한다.
    let note = "";
    let noteUpdatedAt = null;
    const prevPath = worklogPath(date);
    if (existsSync(prevPath)) {
      try {
        const prev = JSON.parse(await readFile(prevPath, "utf8"));
        note = prev.note || "";
        noteUpdatedAt = prev.noteUpdatedAt || null;
      } catch {}
    }
    const tasks = await loadTasks();
    const data = buildWorklogData(tasks, date);
    const [aiComment, digest] = await Promise.all([
      generateAiComment(data, process.env.ANTHROPIC_API_KEY),
      generateDigest(data, process.env.ANTHROPIC_API_KEY),
    ]);
    // 오늘 채널톡 '채팅 인입' 요약 첨부(전화·ALF는 Open API 미제공 → 제외). 실패해도 일지 생성은 계속
    let cs = null;
    try {
      cs = await csChatSummary();
    } catch (e) {
      console.warn("업무일지 CS 요약 실패(무시):", String(e?.message ?? e));
    }
    // 브리핑 섹션 안정화: AI가 비워 보낸 항목은 데이터로 보완(특히 '내일')
    if (digest) {
      digest.threeLine = Array.isArray(digest.threeLine) ? digest.threeLine : [];
      digest.flow = Array.isArray(digest.flow) ? digest.flow : [];
      digest.stories = Array.isArray(digest.stories) ? digest.stories : [];
      digest.watch = Array.isArray(digest.watch) ? digest.watch : [];
      if (!Array.isArray(digest.tomorrow) || digest.tomorrow.length === 0) {
        const ip = (data.assignees || []).flatMap((a) => (a.inProgress || []).map((t) => `${t.name} 이어서 진행 (${a.name})`)).slice(0, 3);
        const oh = (data.assignees || []).flatMap((a) => (a.onHold || []).map((t) => `${t.name} 처리 (${a.name})`)).slice(0, 2);
        digest.tomorrow = [...ip, ...oh];
      }
    }
    const report = {
      ...data,
      aiComment,
      digest, // 데일리 브리핑(세 줄 요약·오늘의 이야기·지켜볼것·내일)
      cs, // 오늘 채널톡 CS 응대 요약
      text: worklogToText(data),
      auto,
      note,
      noteUpdatedAt,
      generatedAt: new Date().toISOString(),
    };
    await writeFile(worklogPath(date), JSON.stringify(report, null, 2));
    console.log(`📝 업무일지 생성: ${date} (${auto ? "자동" : "수동"}) — 완료 ${data.summary.doneToday}건`);
    return report;
  } finally {
    worklogGenerating = false;
  }
}

// 저장된 일지 날짜 목록(최신순)
async function listWorklogDates() {
  try {
    const files = await readdir(WORKLOGS_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// 특정 날짜(기본: 최신) 일지 조회
app.get("/api/worklog", async (req, res) => {
  try {
    const dates = await listWorklogDates();
    const date = req.query.date ? String(req.query.date) : dates[0];
    if (!date) return res.json({ exists: false, dates: [] });
    const path = worklogPath(date);
    if (!existsSync(path)) return res.json({ exists: false, date, dates });
    const report = JSON.parse(await readFile(path, "utf8"));
    res.json({ exists: true, dates, report });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 수동 생성(오늘) — "지금 생성" 버튼
app.post("/api/worklog/generate", async (_req, res) => {
  if (worklogGenerating)
    return res.status(409).json({ error: "이미 생성 중입니다. 잠시 후 다시 시도하세요." });
  try {
    const report = await generateWorklog({ auto: false });
    const dates = await listWorklogDates();
    res.json({ exists: true, dates, report });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 빈(집계 없는) 일지 — 직원이 임의 날짜에 직접 작성할 때의 기본 골격
function emptyWorklogReport(date) {
  return {
    date,
    summary: { total: 0, doneToday: 0, inProgress: 0, onHold: 0, waiting: 0, stale: 0 },
    assignees: [],
    aiComment: null,
    text: "",
    auto: false,
    note: "",
    noteUpdatedAt: null,
    generatedAt: new Date().toISOString(),
  };
}

// 자유기입 저장 — 직원이 언제든 임의 날짜의 업무일지/업무일정을 직접 작성.
// 해당 날짜의 자동집계 일지가 있으면 note만 갱신하고, 없으면 새로 만든다.
app.post("/api/worklog/note", async (req, res) => {
  try {
    const date = req.body?.date ? String(req.body.date) : localDateIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)." });
    const note = typeof req.body?.note === "string" ? req.body.note : "";
    const path = worklogPath(date);
    let report;
    if (existsSync(path)) {
      report = JSON.parse(await readFile(path, "utf8"));
    } else {
      report = emptyWorklogReport(date);
    }
    report.note = note;
    report.noteUpdatedAt = new Date().toISOString();
    await writeFile(path, JSON.stringify(report, null, 2));
    console.log(`✍️  업무일지 직접 작성 저장: ${date} (${note.length}자)`);
    const dates = await listWorklogDates();
    res.json({ exists: true, dates, report });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ===== 월간 업무일지 (매월 1일: 직전 월 일일일지 종합) =====
const monthlyPath = (ym) => join(WORKLOGS_DIR, `monthly-${ym}.json`);
function prevMonthYm(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth(); // m: 0~11
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}
async function generateMonthlyWorklog(ym) {
  const files = await readdir(WORKLOGS_DIR).catch(() => []);
  const dayFiles = files.filter((f) => f.startsWith(ym + "-") && /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const perPerson = {};
  const notes = [];
  let doneTotal = 0, dayCount = 0;
  for (const f of dayFiles) {
    const r = await readJson(join(WORKLOGS_DIR, f));
    if (!r) continue;
    dayCount++;
    doneTotal += r.summary?.doneToday || 0;
    for (const a of r.assignees || []) {
      const p = (perPerson[a.name] = perPerson[a.name] || { name: a.name, role: a.role || null, done: 0 });
      if (a.role && !p.role) p.role = a.role;
      p.done += a.done?.length || 0;
    }
    if (r.note && r.note.trim()) notes.push({ date: r.date, note: r.note.trim() });
  }
  const people = Object.values(perPerson).sort((a, b) => b.done - a.done);
  // 월간 AI 브리핑
  const monthText =
    `■ ${ym} 월간 업무 종합\n집계 ${dayCount}일 · 총 완료 ${doneTotal}건\n\n[구성원별 완료]\n` +
    people.map((p) => `· ${p.name}${p.role ? `(${p.role})` : ""}: ${p.done}건`).join("\n") +
    (notes.length ? `\n\n[직접 작성 메모 발췌]\n` + notes.slice(0, 20).map((n) => `(${n.date}) ${n.note}`).join("\n") : "");
  const ai = await generateMonthlyDigest(monthText, process.env.ANTHROPIC_API_KEY);
  const digest = {
    month: ym,
    dayCount,
    doneTotal,
    people,
    notes,
    ai, // 월간 AI 브리핑(세 줄 요약·하이라이트)
    generatedAt: new Date().toISOString(),
  };
  await writeFile(monthlyPath(ym), JSON.stringify(digest, null, 2));
  console.log(`🗓️ 월간 업무일지 생성: ${ym} — 완료 ${doneTotal}건 / ${dayCount}일`);
  return digest;
}
async function listWorklogMonths() {
  try {
    const files = await readdir(WORKLOGS_DIR);
    return files.filter((f) => /^monthly-\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(8, 15)).sort().reverse();
  } catch {
    return [];
  }
}
app.get("/api/worklog/monthly", async (req, res) => {
  try {
    const months = await listWorklogMonths();
    const month = req.query.month ? String(req.query.month) : months[0] || prevMonthYm();
    let digest = await readJson(monthlyPath(month));
    if (!digest) digest = await generateMonthlyWorklog(month); // 없으면 즉석 생성
    if (!months.includes(month)) months.unshift(month);
    res.json({ exists: !!digest, months, digest });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ===== 업무일지 PDF 저장 / 대표님 슬랙 전송 =====
async function getWorklogReport(date) {
  const d = date || (await listWorklogDates())[0];
  if (!d || !existsSync(worklogPath(d))) return null;
  return JSON.parse(await readFile(worklogPath(d), "utf8"));
}
async function renderPdf(html) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  } finally {
    await browser.close();
  }
}
async function slackUploadPdf(pdf, filename, title, comment) {
  const { SLACK_BOT_TOKEN, SLACK_CEO_CHANNEL } = process.env;
  if (!SLACK_BOT_TOKEN || !SLACK_CEO_CHANNEL)
    throw new Error("SLACK_BOT_TOKEN / SLACK_CEO_CHANNEL(.env) 설정이 필요합니다 — 대표님 슬랙 전송용");
  // 대상이 사용자 ID(U…)면 DM 채널을 열어 그 채널로 보낸다
  let channelId = SLACK_CEO_CHANNEL;
  if (/^U/i.test(channelId)) {
    const o = await (await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: { Authorization: "Bearer " + SLACK_BOT_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ users: SLACK_CEO_CHANNEL }),
    })).json();
    if (!o.ok) throw new Error("DM 열기 오류: " + o.error + " (봇에 im:write 권한 필요)");
    channelId = o.channel.id;
  }
  const u = await (await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: { Authorization: "Bearer " + SLACK_BOT_TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ filename, length: String(pdf.length) }),
  })).json();
  if (!u.ok) throw new Error("Slack 업로드URL 오류: " + u.error);
  const put = await fetch(u.upload_url, { method: "POST", body: pdf });
  if (!put.ok) throw new Error("Slack 파일 전송 오류: " + put.status);
  const c = await (await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: { Authorization: "Bearer " + SLACK_BOT_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ files: [{ id: u.file_id, title }], channel_id: channelId, initial_comment: comment }),
  })).json();
  if (!c.ok) throw new Error("Slack 업로드 완료 오류: " + c.error);
  return c;
}

app.get("/api/worklog/pdf", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : (await listWorklogDates())[0];
    const report = await getWorklogReport(date);
    if (!report) return res.status(404).json({ error: "해당 날짜 업무일지가 없습니다." });
    const pdf = await renderPdf(buildWorklogHtml(report));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="worklog-${date}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
app.post("/api/worklog/send-slack", async (req, res) => {
  try {
    const date = req.body?.date ? String(req.body.date) : (await listWorklogDates())[0];
    const report = await getWorklogReport(date);
    if (!report) return res.status(404).json({ error: "해당 날짜 업무일지가 없습니다." });
    const pdf = await renderPdf(buildWorklogHtml(report));
    await slackUploadPdf(pdf, `업무일지_${date}.pdf`, `업무일지 ${date}`, `📄 ${date} 업무일지입니다.`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 매일 19:00 자동 생성 스케줄러(BFF 가동 중일 때) + 가동 시 당일 누락분 보완
function msUntilNextWorklog() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(WORKLOG_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}
function scheduleDailyWorklog() {
  const wait = msUntilNextWorklog();
  console.log(`⏰ 다음 업무일지 자동생성까지 ${Math.round(wait / 60000)}분 (매일 ${WORKLOG_HOUR}:00)`);
  setTimeout(async () => {
    try {
      await generateWorklog({ auto: true });
      // 매월 1일이면 직전 월 종합(월간 업무일지) 생성
      if (new Date().getDate() === 1) await generateMonthlyWorklog(prevMonthYm());
    } catch (e) {
      console.error("업무일지 자동생성 실패:", String(e?.message ?? e));
    }
    scheduleDailyWorklog(); // 다음 날 예약
  }, wait);
}
async function catchUpWorklog() {
  const now = new Date();
  // 이미 19시가 지났는데 오늘 일지가 없으면(예: PC가 19시에 꺼져 있었음) 보완 생성
  if (now.getHours() >= WORKLOG_HOUR && !existsSync(worklogPath(localDateIso(now)))) {
    try {
      console.log("🔁 오늘(19시 이후) 업무일지 누락 감지 → 보완 생성");
      await generateWorklog({ auto: true });
    } catch (e) {
      console.error("업무일지 보완 생성 실패:", String(e?.message ?? e));
    }
  }
  // 1일인데 직전 월 종합이 없으면 보완 생성
  if (now.getDate() === 1) {
    const pm = prevMonthYm(now);
    if (!existsSync(monthlyPath(pm))) {
      try {
        await generateMonthlyWorklog(pm);
      } catch (e) {
        console.error("월간 업무일지 보완 생성 실패:", String(e?.message ?? e));
      }
    }
  }
}

// ===== 유튜브 채널 지표 (YouTube Data API v3, 공개지표) =====
const { YOUTUBE_API_KEY, YOUTUBE_CHANNEL } = process.env;
let ytCache = { at: 0, data: null };
const YT_TTL = 10 * 60 * 1000; // 10분 캐시(할당량 보호)

async function ytFetch(path, params) {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  url.searchParams.set("key", YOUTUBE_API_KEY);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(`유튜브 API ${r.status}: ${j?.error?.message ?? ""}`);
  return j;
}

async function loadYoutube() {
  const ch = String(YOUTUBE_CHANNEL || "").trim();
  // 채널ID(UC…) 또는 핸들(@…) 모두 지원
  const chParams = /^UC[\w-]{22}$/.test(ch)
    ? { id: ch }
    : { forHandle: ch.startsWith("@") ? ch : "@" + ch };
  const cj = await ytFetch("channels", { part: "snippet,statistics,contentDetails", ...chParams });
  const c = cj.items?.[0];
  if (!c) throw new Error("채널을 찾지 못했습니다 — YOUTUBE_CHANNEL 값을 확인하세요(채널ID UC… 또는 @핸들).");
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  let recentVideos = [];
  if (uploads) {
    const pj = await ytFetch("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 6 });
    const ids = (pj.items ?? []).map((i) => i.contentDetails.videoId).filter(Boolean).join(",");
    if (ids) {
      const vj = await ytFetch("videos", { part: "snippet,statistics", id: ids });
      recentVideos = (vj.items ?? []).map((v) => ({
        id: v.id,
        title: v.snippet?.title ?? "",
        views: Number(v.statistics?.viewCount ?? 0),
        publishedAt: v.snippet?.publishedAt ?? null,
        url: "https://youtu.be/" + v.id,
        thumb:
          v.snippet?.thumbnails?.maxres?.url ??
          v.snippet?.thumbnails?.high?.url ??
          v.snippet?.thumbnails?.medium?.url ??
          v.snippet?.thumbnails?.default?.url ??
          null,
      }));
    }
  }
  const s = c.statistics ?? {};
  return {
    channelTitle: c.snippet?.title ?? "",
    thumb: c.snippet?.thumbnails?.default?.url ?? null,
    url: ch.startsWith("UC")
      ? "https://youtube.com/channel/" + ch
      : "https://youtube.com/" + (ch.startsWith("@") ? ch : "@" + ch),
    subscribers: Number(s.subscriberCount ?? 0),
    totalViews: Number(s.viewCount ?? 0),
    videoCount: Number(s.videoCount ?? 0),
    recentVideos,
    updatedAt: new Date().toISOString(),
  };
}

app.get("/api/youtube", async (_req, res) => {
  try {
    if (!YOUTUBE_API_KEY || !YOUTUBE_CHANNEL)
      return res.status(400).json({ error: "YOUTUBE_API_KEY / YOUTUBE_CHANNEL(.env) 설정이 필요합니다 — 유튜브 지표용" });
    const now = Date.now();
    if (!ytCache.data || now - ytCache.at > YT_TTL) ytCache = { at: now, data: await loadYoutube() };
    res.json(ytCache.data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ===== 전체 데이터 동기화 (수집 스크래퍼 + 캐시 갱신) — 수동 버튼 / 매일 8시 =====
const COLLECT_SCRIPTS = [
  "kovan-tr-scraper.mjs",
  "ddwm-tr-scraper.mjs",
  "kovan-inactive-scraper.mjs",
  "ddwm-inactive-scraper.mjs",
];
let collectState = { running: false, startedAt: null, finishedAt: null, ok: null, errors: [], auto: false };

async function runCollect({ auto = false } = {}) {
  if (collectState.running) return collectState;
  collectState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, errors: [], auto };
  console.log(`📦 데이터 동기화 시작 (${auto ? "자동 8시" : "수동"})`);
  try {
    for (const s of COLLECT_SCRIPTS) {
      const r = await runScript(s);
      if (r.code !== 0) collectState.errors.push(`${s}: ${(r.stderr.trim().split("\n").pop() || "실패")}`);
    }
    ytCache = { at: 0, data: null }; // 유튜브 캐시 무효화 → 다음 조회 시 최신
  } catch (e) {
    collectState.errors.push(String(e?.message ?? e));
  } finally {
    collectState.running = false;
    collectState.finishedAt = new Date().toISOString();
    collectState.ok = collectState.errors.length === 0;
    console.log(`📦 데이터 동기화 완료 — 오류 ${collectState.errors.length}건`);
  }
  return collectState;
}

app.post("/api/collect", (_req, res) => {
  if (collectState.running) return res.status(409).json({ error: "이미 동기화 진행 중입니다.", state: collectState });
  runCollect({ auto: false }); // 수 분 소요 → 기다리지 않고 백그라운드 실행
  res.json({ started: true });
});
app.get("/api/collect/status", (_req, res) => res.json(collectState));

// 매일 08:00 자동 데이터 동기화 스케줄러
const COLLECT_HOUR = 8;
function scheduleDailyCollect() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(COLLECT_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const wait = next - now;
  console.log(`⏰ 다음 데이터 동기화까지 ${Math.round(wait / 60000)}분 (매일 ${COLLECT_HOUR}:00)`);
  setTimeout(async () => {
    try {
      await runCollect({ auto: true });
    } catch (e) {
      console.error("자동 데이터 동기화 실패:", String(e?.message ?? e));
    }
    scheduleDailyCollect();
  }, wait);
}

// ===== 구글캘린더 일정 (읽기 전용) =====
// 서비스 계정 JWT → OAuth 토큰 발급 → Calendar v3 events 조회. (googleapis 의존성 없이 내장 crypto 사용)
const b64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

let gToken = { value: null, exp: 0 };

async function getGoogleToken() {
  const now = Math.floor(Date.now() / 1000);
  if (gToken.value && gToken.exp - 60 > now) return gToken.value;
  if (!GOOGLE_SA_EMAIL || !GOOGLE_SA_PRIVATE_KEY) {
    throw new Error(
      "구글 서비스계정 미설정 (.env: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY)"
    );
  }
  const key = GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, "\n");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: GOOGLE_SA_EMAIL,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = signer
    .sign(key)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const assertion = `${header}.${claim}.${sig}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await r.json();
  if (!r.ok)
    throw new Error(
      `구글 인증 실패: ${body.error_description || body.error || r.status}`
    );
  gToken = { value: body.access_token, exp: now + (body.expires_in || 3600) };
  return gToken.value;
}

// "라벨|url,라벨|url" 또는 "url,url" 형식 파싱 (URL에는 , | 가 없음)
function parseIcsCalendars(raw) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const pipe = entry.indexOf("|");
      if (pipe === -1) return { label: `캘린더${i + 1}`, url: entry };
      return {
        label: entry.slice(0, pipe).trim(),
        url: entry.slice(pipe + 1).trim(),
      };
    });
}

// 방식 A: iCal(.ics) URL 파싱 — 반복 일정(RRULE)도 기간 내로 펼쳐서 반환
async function eventsFromIcs(icsUrl, label, rangeStart, rangeEnd) {
  const ical = (await import("node-ical")).default;
  const data = await ical.async.fromURL(icsUrl);
  const out = [];
  const push = (ev, start, end) =>
    out.push({
      id: `${label}-${ev.uid || ev.summary}-${start.getTime()}`,
      title: ev.summary || "(제목 없음)",
      cal: label,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
      allDay: ev.datetype === "date",
      location: ev.location || null,
      description: ev.description || null,
      organizer:
        (ev.organizer && (ev.organizer.params?.CN || ev.organizer.val)) || null,
      url: typeof ev.url === "string" ? ev.url : null,
    });

  for (const key of Object.keys(data)) {
    const ev = data[key];
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
    const durMs = ev.end ? ev.end.getTime() - ev.start.getTime() : 0;

    if (ev.rrule) {
      const exdates = Object.values(ev.exdate || {}).map((d) =>
        new Date(d).toDateString()
      );
      for (const d of ev.rrule.between(rangeStart, rangeEnd, true)) {
        const dayStr = d.toDateString();
        const rec = ev.recurrences && ev.recurrences[d.toISOString().slice(0, 10)];
        if (rec) {
          push(rec, rec.start, rec.end);
          continue;
        }
        if (exdates.includes(dayStr)) continue;
        push(ev, d, new Date(d.getTime() + durMs));
      }
    } else if (ev.start >= rangeStart && ev.start <= rangeEnd) {
      push(ev, ev.start, ev.end);
    }
  }
  return out;
}

// 여러 캘린더를 병렬로 조회·병합
async function eventsFromIcsAll(raw, rangeStart, rangeEnd) {
  const cals = parseIcsCalendars(raw);
  const results = await Promise.all(
    cals.map((c) => eventsFromIcs(c.url, c.label, rangeStart, rangeEnd))
  );
  const events = results.flat();
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { calendars: cals.map((c) => c.label), events: events.slice(0, 200) };
}

// ===== 방식 B: 서비스계정 + Calendar API (양방향) =====
const calApi = (path) =>
  `https://www.googleapis.com/calendar/v3/calendars/${path}`;

async function gFetch(url, init = {}) {
  const token = await getGoogleToken();
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = r.status === 204 ? {} : await r.json();
  if (!r.ok)
    throw new Error(body?.error?.message || `구글 캘린더 오류: ${r.status}`);
  return body;
}

const labelToId = (label) =>
  API_CALENDARS.find((c) => c.label === label)?.id || null;
const idToLabel = (id) =>
  API_CALENDARS.find((c) => c.id === id)?.label || id;

function mapApiEvent(e, calId) {
  return {
    id: `${calId}::${e.id}`,
    eventId: e.id,
    calendarId: calId,
    cal: idToLabel(calId),
    title: e.summary || "(제목 없음)",
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    allDay: !e.start?.dateTime,
    location: e.location || null,
    description: e.description || null,
    organizer: e.organizer?.displayName || e.organizer?.email || null,
    url: e.htmlLink || null,
  };
}

async function eventsFromApiAll(rangeStart, rangeEnd) {
  const lists = await Promise.all(
    API_CALENDARS.map(async (c) => {
      const url = new URL(calApi(`${encodeURIComponent(c.id)}/events`));
      url.searchParams.set("timeMin", rangeStart.toISOString());
      url.searchParams.set("timeMax", rangeEnd.toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "250");
      const body = await gFetch(url);
      return (body.items || []).map((e) => mapApiEvent(e, c.id));
    })
  );
  const events = lists.flat();
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { calendars: API_CALENDARS.map((c) => c.label), events };
}

// 우리 payload → 구글 이벤트 리소스
function toGoogleEvent(p) {
  const ev = {
    summary: p.title || "(제목 없음)",
    location: p.location || undefined,
    description: p.description || undefined,
  };
  if (p.allDay) {
    // 종일: end.date 는 배타적(exclusive) → 마지막날 +1
    const startDate = p.start.slice(0, 10);
    const endBase = (p.end || p.start).slice(0, 10);
    const ex = new Date(`${endBase}T00:00:00`);
    ex.setDate(ex.getDate() + 1);
    ev.start = { date: startDate };
    ev.end = { date: ex.toISOString().slice(0, 10) };
  } else {
    ev.start = { dateTime: new Date(p.start).toISOString(), timeZone: TZ };
    const end = p.end ? new Date(p.end) : new Date(new Date(p.start).getTime() + 3600000);
    ev.end = { dateTime: end.toISOString(), timeZone: TZ };
  }
  return ev;
}

app.get("/api/schedule", async (req, res) => {
  const now = new Date();
  const parseDate = (v, fallback) => {
    if (!v) return fallback;
    const d = new Date(v);
    return isNaN(d.getTime()) ? fallback : d;
  };
  const rangeStart = parseDate(req.query.from, now);
  const rangeEnd = parseDate(
    req.query.to,
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  );
  try {
    // API 모드 우선(양방향). 미설정 시 iCal(읽기 전용)로 폴백.
    if (API_MODE) {
      const { calendars, events } = await eventsFromApiAll(rangeStart, rangeEnd);
      return res.json({
        configured: true,
        editable: true,
        calendar: calendars.join(" · "),
        calendars,
        fetchedAt: now.toISOString(),
        events,
      });
    }
    if (GOOGLE_CALENDAR_ICS_URL) {
      const { calendars, events } = await eventsFromIcsAll(
        GOOGLE_CALENDAR_ICS_URL,
        rangeStart,
        rangeEnd
      );
      return res.json({
        configured: true,
        editable: false,
        calendar: calendars.join(" · "),
        calendars,
        fetchedAt: now.toISOString(),
        events,
      });
    }
    return res.json({
      configured: false,
      editable: false,
      events: [],
      note: "구글캘린더 미설정: 양방향 편집은 .env 에 GOOGLE_SA_EMAIL·GOOGLE_SA_PRIVATE_KEY·GOOGLE_CALENDARS 를 설정하세요.",
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 일정 생성
app.post("/api/schedule", async (req, res) => {
  if (!API_MODE)
    return res.status(400).json({ error: "양방향(쓰기) 모드가 아닙니다." });
  try {
    const p = req.body || {};
    const calId = labelToId(p.cal) || (API_CALENDARS[0] && API_CALENDARS[0].id);
    if (!calId) throw new Error("대상 캘린더를 찾을 수 없습니다.");
    if (!p.start) throw new Error("시작 일시가 필요합니다.");
    const body = await gFetch(calApi(`${encodeURIComponent(calId)}/events`), {
      method: "POST",
      body: JSON.stringify(toGoogleEvent(p)),
    });
    res.json(mapApiEvent(body, calId));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 일정 수정
app.patch("/api/schedule/:eventId", async (req, res) => {
  if (!API_MODE)
    return res.status(400).json({ error: "양방향(쓰기) 모드가 아닙니다." });
  try {
    const p = req.body || {};
    const calId = p.calendarId || labelToId(p.cal);
    if (!calId) throw new Error("대상 캘린더를 찾을 수 없습니다.");
    const body = await gFetch(
      calApi(
        `${encodeURIComponent(calId)}/events/${encodeURIComponent(
          req.params.eventId
        )}`
      ),
      { method: "PATCH", body: JSON.stringify(toGoogleEvent(p)) }
    );
    res.json(mapApiEvent(body, calId));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 일정 삭제
app.delete("/api/schedule/:eventId", async (req, res) => {
  if (!API_MODE)
    return res.status(400).json({ error: "양방향(쓰기) 모드가 아닙니다." });
  try {
    const calId = req.query.calendarId;
    if (!calId) throw new Error("calendarId 가 필요합니다.");
    await gFetch(
      calApi(
        `${encodeURIComponent(calId)}/events/${encodeURIComponent(
          req.params.eventId
        )}`
      ),
      { method: "DELETE" }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 운영 배포용: 빌드된 프론트(dist)를 같은 서버에서 서빙 → 서버 1개·포트 1개로 운영
// (개발 중엔 Vite(5173)를 쓰므로 영향 없음. dist가 있으면 8787에서 화면+API 모두 제공)
const distDir = join(dirname(__dirname), "dist");
const indexHtml = join(distDir, "index.html");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    // /api 가 아닌 GET 요청은 SPA(index.html)로 (새로고침·딥링크 대응)
    if (req.method === "GET" && !req.path.startsWith("/api") && existsSync(indexHtml)) {
      return res.sendFile(indexHtml);
    }
    next();
  });
}

app.listen(Number(BFF_PORT), () => {
  console.log(
    `BFF 실행 중: http://localhost:${BFF_PORT}  (/api/* + dist 정적 서빙${existsSync(distDir) ? " ON" : " OFF(빌드 전)"})`
  );
  // 업무일지: 매일 18:00 자동 생성 예약 + 가동 시 당일 누락분 보완
  scheduleDailyWorklog();
  catchUpWorklog();
  // 데이터 동기화: 매일 08:00 자동 수집(코밴·다우데이타 거래·무실적)
  scheduleDailyCollect();
});
