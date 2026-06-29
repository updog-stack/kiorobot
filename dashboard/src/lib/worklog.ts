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

export interface WorklogReport {
  date: string;
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
