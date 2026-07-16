// 업무현황 데이터 레이어 — 노션 [업무 DB]를 BFF(/api/tasks)가 정규화해 내려준다.
// (BFF: server/notion-sales-bff.mjs 의 /api/tasks)

export type TaskStatus = "업무대기" | "진행중" | "보류중" | "처리완료";
export type TaskPriority = "높음" | "중간" | "낮음";

export interface TaskRecord {
  id: string;
  url: string;
  name: string;
  status: TaskStatus | string;
  assignee: string; // 담당자명 (예: "김소원")
  role: string | null; // 직책 (사원/주임/대리/팀장)
  priority: TaskPriority | string | null;
  depts: string[]; // 연관부서
  content: string; // 업무내용
  collab: string[]; // 협업자 이름들
  requester: string | null; // 요청자 이름
  ext: string[]; // 외부 상대(카드사·효성 등)
  category: string | null; // 업무분류
  taskDate: string | null; // 업무일자
  startDate: string | null; // 진행시작일
  doneDate: string | null; // 완료일
  lastStatusChange: string | null;
  lastEdited: string | null;
  created: string | null;
  stale: boolean; // 정체플래그
  trash: boolean;
}

export interface TasksPayload {
  updatedAt: string;
  tasks: TaskRecord[];
}

export const STATUS_ORDER: TaskStatus[] = ["진행중", "업무대기", "보류중", "처리완료"];

export async function fetchTasks(): Promise<TasksPayload> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error(`업무 데이터 조회 실패: ${res.status}`);
  return (await res.json()) as TasksPayload;
}

// ===== 업무현황 AI 요약 =====
export interface TaskSummary {
  headline: string;
  highlights: string[];
  attention: string[];
}
export interface TaskSummaryResponse {
  summary: TaskSummary | null;
  counts?: { total: number; active: number; stale: number };
  cached?: boolean;
  generatedAt: string | null;
  error?: string;
}
export async function fetchTaskSummary(force = false): Promise<TaskSummaryResponse> {
  const res = await fetch(`/api/tasks/summary${force ? "?force=1" : ""}`);
  const body = (await res.json()) as TaskSummaryResponse;
  if (!res.ok) throw new Error((body as { error?: string })?.error || `요약 실패: ${res.status}`);
  return body;
}

// ===== CS 채널톡 상담 요약 (업무내용에 '채널톡 참고' 표시 시) =====
export interface CsSummaryItem {
  label: string;       // 매장명, 없으면 전화번호
  store: string | null;
  phone: string | null;
  summary: string;
  url: string | null;
}
export interface CsDaySummaryResponse {
  assignee?: string;
  date?: string;
  count: number;
  items: CsSummaryItem[];
  note?: string;
  error?: string;
  cached?: boolean;
  generatedAt: string | null;
}
export async function fetchCsDaySummary(assignee: string, date: string, force = false): Promise<CsDaySummaryResponse> {
  const q = new URLSearchParams({ assignee, date });
  if (force) q.set("force", "1");
  const res = await fetch(`/api/cs/day-summary?${q.toString()}`);
  const body = (await res.json()) as CsDaySummaryResponse;
  if (!res.ok) throw new Error((body as { error?: string })?.error || `CS 요약 실패: ${res.status}`);
  return body;
}

// 업무내용에 '채널톡 참고' 류 표시가 있는지
export function wantsCsSummary(text?: string | null): boolean {
  if (!text) return false;
  return /채널톡\s*(통계|상담)?\s*(로|으로)?\s*참고/.test(text) || /채널톡\s*참고/.test(text);
}

// ===== 담당업무 심층분석 (직원별) =====
export interface ResponsibilityAnalysis {
  headline: string;
  mainAreas: string[];
  collaboration: string[];
  partners: string[];
  notes: string[];
}
export interface ResponsibilityResponse {
  assignee: string;
  count: number;
  active: number;
  byCategory: Record<string, number>;
  collaborators: Record<string, number>;
  partners: Record<string, number>;
  requesters: Record<string, number>;
  depts: Record<string, number>;
  analysis: ResponsibilityAnalysis | null;
  note?: string;
  error?: string;
  cached?: boolean;
  generatedAt: string | null;
}
export async function fetchResponsibilityAnalysis(assignee: string, force = false): Promise<ResponsibilityResponse> {
  const q = new URLSearchParams({ assignee });
  if (force) q.set("force", "1");
  const res = await fetch(`/api/responsibility/analysis?${q.toString()}`);
  const body = (await res.json()) as ResponsibilityResponse;
  if (!res.ok) throw new Error((body as { error?: string })?.error || `분석 실패: ${res.status}`);
  return body;
}

// "YYYY-MM-DD" (로컬 오늘)
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDoneToday(t: TaskRecord): boolean {
  if (t.status !== "처리완료") return false;
  const ref = (t.doneDate || t.lastStatusChange || t.lastEdited || "").slice(0, 10);
  return ref === todayIso();
}

// ===== 내근/외근 (ERP에서 직접 변경) =====
export type WorkLocation = "내근" | "외근";
export type StaffLocations = Record<string, WorkLocation>;

export async function getStaffLocations(): Promise<StaffLocations> {
  const res = await fetch("/api/staff-location");
  if (!res.ok) throw new Error(`근무상태 조회 실패: ${res.status}`);
  return (await res.json()) as StaffLocations;
}
export async function setStaffLocation(name: string, location: WorkLocation): Promise<StaffLocations> {
  const res = await fetch("/api/staff-location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, location }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `저장 실패: ${res.status}`);
  return body.locations as StaffLocations;
}

// ===== 업무 부하 4단계 (자동 판단 — 진행 중인 담당 업무 수 기준) =====
export interface BusyLevel {
  label: "여유" | "보통" | "바쁨" | "업무과부하";
  color: string;
  bg: string;
}
export function busyLevel(activeOwned: number, stale: number): BusyLevel {
  const score = activeOwned + stale; // 정체 업무는 부하 가중
  if (score >= 7) return { label: "업무과부하", color: "#b91c1c", bg: "#fee2e2" };
  if (score >= 5) return { label: "바쁨", color: "#b45309", bg: "#fef3c7" };
  if (score >= 3) return { label: "보통", color: "#1d4ed8", bg: "#dbeafe" };
  return { label: "여유", color: "#047857", bg: "#d1fae5" };
}
