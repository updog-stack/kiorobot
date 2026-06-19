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
//   1) npm i express cors dotenv @notionhq/client
//   2) .env 에 NOTION_TOKEN 작성
//   3) node server/notion-sales-bff.mjs
//   4) src/lib/sales.ts 의 USE_MOCK = false

import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import express from "express";
import cors from "cors";
import { Client } from "@notionhq/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TR_JSON = join(__dirname, "data", "tr.json");
const TR_DDWM_JSON = join(__dirname, "data", "tr-ddwm.json");
const INACTIVE_JSON = join(__dirname, "data", "inactive.json");
const INACTIVE_DDWM_JSON = join(__dirname, "data", "inactive-ddwm.json");
const INACTIVE_STATUS_JSON = join(__dirname, "data", "inactive-status.json");
const DDWM_SALES_JSON = join(__dirname, "data", "ddwm-sales-2025.json");
const PLAYBOOKS_JSON = join(__dirname, "data", "playbooks.json");

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

const { NOTION_TOKEN, BFF_PORT = 8787 } = process.env;
if (!NOTION_TOKEN) {
  console.error("환경변수 NOTION_TOKEN 이 필요합니다 (.env).");
  process.exit(1);
}

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
app.use(cors());
app.use(express.json());

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
async function chatCalls(chat) {
  if (!_callCache) _callCache = (await readJson(CALL_DETAIL_JSON)) || {};
  const hit = _callCache[chat.id];
  if (hit && hit.state === "closed") return hit.calls; // 종료 상담은 캐시 재사용(메시지 재조회 안 함)
  try {
    const j = await chFetch(`/user-chats/${chat.id}/messages`, { limit: 50, sortOrder: "asc" });
    const calls = [];
    for (const m of j.messages ?? []) {
      const cl = m.meet?.call;
      if (cl && cl.direction) calls.push({ dir: cl.direction, to: cl.to, from: cl.from, at: cl.createAt || m.createdAt });
    }
    _callCache[chat.id] = { state: chat.state, calls };
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

// 채널톡 최근 상담의 핵심 문의 텍스트 수집
async function gatherIssues(limit = 50) {
  const closed = await chListUserChats("closed", Date.now() - 30 * 24 * 3600 * 1000);
  const issues = [];
  for (const c of closed.slice(0, limit)) {
    try {
      const m = await chFetch(`/user-chats/${c.id}/messages`, { limit: 4, sortOrder: "asc" });
      const txt = (m.messages ?? []).map((x) => x.plainText).find((t) => t && t.trim());
      if (txt) {
        issues.push({
          medium: c.source?.medium?.mediumType === "phone" ? "전화" : "채팅",
          tags: (c.tags ?? []).join(","),
          text: txt.replace(/\s+/g, " ").slice(0, 240),
        });
      }
    } catch {}
  }
  return issues;
}

app.post("/api/playbooks/generate", async (_req, res) => {
  try {
    const issues = await gatherIssues(50);
    if (!issues.length) return res.status(400).json({ error: "상담 이력을 가져오지 못했습니다." });

    const system =
      "너는 고객상담(CS) 지식베이스 설계자다. 주어진 실제 상담 문의 목록을 보고, 상담원이 선택지를 단계별로 클릭하며 따라가다 '해결책'에 도달하는 의사결정 트리(플레이북)들을 한국어로 설계한다. 자주 나오는 문의 유형 3~6개를 골라 각각 하나의 플레이북으로 만든다. 각 플레이북은 root 질문에서 시작해 2~4단계 깊이로, 마지막은 answer(해결책) 노드로 끝난다. 반드시 아래 JSON 스키마의 배열만 출력하고, 코드펜스나 설명은 쓰지 마라.";
    const schema =
      '[{"title":"문의 유형 제목","category":"분류(결제/단말기/가맹점/정산/기타)","rootId":"n1","nodes":{"n1":{"id":"n1","text":"질문 또는 확인사항","options":[{"label":"선택지 텍스트","next":"n2"}]},"n2":{"id":"n2","text":"해결책/안내 문구","answer":true}}}]';
    const user = `다음은 최근 상담 문의 ${issues.length}건이다(매체/태그/내용):\n${issues
      .map((x, i) => `${i + 1}. [${x.medium}${x.tags ? "/" + x.tags : ""}] ${x.text}`)
      .join("\n")}\n\n이 문의들을 유형별로 묶어 의사결정 트리 플레이북 배열(JSON)로 만들어줘. 스키마:\n${schema}`;

    let txt = await claudeText(system, user);
    txt = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const arr = JSON.parse(txt);
    const ts = Date.now();
    const generated = (Array.isArray(arr) ? arr : []).map((p, i) => ({
      ...p,
      id: `ai-${ts}-${i}`,
      ai: true,
    }));

    const cur = (await readJson(PLAYBOOKS_JSON)) ?? PLAYBOOK_SEED;
    const next = { playbooks: [...generated, ...cur.playbooks] };
    await writeFile(PLAYBOOKS_JSON, JSON.stringify(next, null, 2));
    res.json({ added: generated.length, data: next });
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
});
