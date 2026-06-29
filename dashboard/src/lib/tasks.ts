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
