// 업무일지 데이터 레이어 — BFF(/api/worklog)가 매일 18:00 자동 생성한 일지를 조회/생성.

export interface WorklogTaskLite {
  name: string;
  url: string;
  priority: string | null;
  stale: boolean;
  depts: string[];
}

export interface WorklogAssignee {
  name: string;
  role: string | null;
  done: WorklogTaskLite[];
  inProgress: WorklogTaskLite[];
  onHold: WorklogTaskLite[];
  waiting: WorklogTaskLite[];
  staleItems: WorklogTaskLite[];
}

export interface DigestStory {
  kind: string; // 성과 · 진전 · 걸림돌
  num: number | null;
  headline: string;
  body: string;
  by: string;
}
export interface DigestWatch {
  badge: string;
  title: string;
  note: string;
}
export interface DailyDigest {
  threeLine: string[];
  flow: string[]; // 하루의 흐름(핵심 순서, 시각 없음)
  stories: DigestStory[];
  watch: DigestWatch[];
  tomorrow: string[];
}

export interface WorklogCs {
  inbound: number; // 오늘 채팅 인입 수
  waiting: number;
  avgFirstResponseSec: number;
  byAgent: { name: string; handled: number }[];
}

export interface WorklogReport {
  date: string;
  digest?: DailyDigest | null;
  cs?: WorklogCs | null;
  summary: {
    total: number;
    doneToday: number;
    inProgress: number;
    onHold: number;
    waiting: number;
    stale: number;
  };
  assignees: WorklogAssignee[];
  aiComment: string | null;
  text: string;
  auto: boolean;
  /** 직원이 자유롭게 직접 작성한 업무일지/업무일정 본문 */
  note?: string;
  /** 자유기입 마지막 저장 시각(ISO) */
  noteUpdatedAt?: string | null;
  generatedAt: string;
}

export interface WorklogResponse {
  exists: boolean;
  date?: string;
  dates: string[];
  report?: WorklogReport;
}

export async function fetchWorklog(date?: string): Promise<WorklogResponse> {
  const url = date ? `/api/worklog?date=${encodeURIComponent(date)}` : "/api/worklog";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`업무일지 조회 실패: ${res.status}`);
  return (await res.json()) as WorklogResponse;
}

export async function generateWorklog(): Promise<WorklogResponse> {
  const res = await fetch("/api/worklog/generate", { method: "POST" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `업무일지 생성 실패: ${res.status}`);
  }
  return (await res.json()) as WorklogResponse;
}

/** 직원이 직접 작성한 업무일지/업무일정 본문을 저장(임의 날짜 가능). */
export async function saveWorklogNote(date: string, note: string): Promise<WorklogResponse> {
  const res = await fetch("/api/worklog/note", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date, note }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `업무일지 저장 실패: ${res.status}`);
  }
  return (await res.json()) as WorklogResponse;
}

// ===== 월간 업무일지 (매월 1일 직전 월 종합) =====
export interface MonthlyPerson {
  name: string;
  role: string | null;
  done: number;
}
export interface MonthlyNote {
  date: string;
  note: string;
}
export interface MonthlyDigest {
  month: string; // "YYYY-MM"
  dayCount: number;
  doneTotal: number;
  people: MonthlyPerson[];
  notes: MonthlyNote[];
  ai?: { threeLine: string[]; highlights: { headline: string; body: string }[] } | null;
  generatedAt: string;
}
export interface MonthlyResponse {
  exists: boolean;
  months: string[];
  digest?: MonthlyDigest;
}

export async function fetchMonthlyWorklog(month?: string): Promise<MonthlyResponse> {
  const url = month ? `/api/worklog/monthly?month=${encodeURIComponent(month)}` : "/api/worklog/monthly";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`월간 업무일지 조회 실패: ${res.status}`);
  return (await res.json()) as MonthlyResponse;
}

// ===== 채널톡 일일 리포트(전화=직접입력·채팅=자동) =====
export interface CsReportRow {
  name: string;
  phone: number;
  chat: number;
  kakao: number;
}
export interface CsReport {
  date: string;
  rows: CsReportRow[];
  totalPhone: number;
  totalChat: number;
  totalKakao: number;
  updatedAt: string | null;
  /** 전부 채널톡 API 자동 집계 */
  auto?: boolean;
  note?: string;
  seeded?: boolean;
}
export async function getCsReport(date: string, force = false): Promise<CsReport> {
  const r = await fetch(`/api/cs-report?date=${encodeURIComponent(date)}${force ? "&force=1" : ""}`);
  if (!r.ok) throw new Error(`CS 리포트 조회 실패: ${r.status}`);
  return (await r.json()) as CsReport;
}
export async function saveCsReport(
  date: string,
  rows: CsReportRow[],
  totalPhone: number,
  totalChat: number
): Promise<CsReport> {
  const r = await fetch("/api/cs-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, rows, totalPhone, totalChat }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b?.error || `저장 실패: ${r.status}`);
  return b as CsReport;
}

// ===== PDF 저장 / 대표님 슬랙 전송 =====
export function worklogPdfUrl(date: string): string {
  return `/api/worklog/pdf?date=${encodeURIComponent(date)}`;
}
export async function sendWorklogSlack(date: string): Promise<void> {
  const r = await fetch("/api/worklog/send-slack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error || `전송 실패: ${r.status}`);
}

/** 로컬 기준 오늘 날짜(YYYY-MM-DD). */
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
