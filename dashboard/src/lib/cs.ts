// CS 현황 데이터 레이어 (담당자별 대기상태 + 일일업무현황).
// 현재 목업(BFF) — 채널톡 등 실제 소스 연동 시 BFF csData()만 교체.

export type CsStatusCode = "available" | "busy" | "away" | "offline";

export interface CsChat {
  name: string; // 매장(고객)명
  url: string; // 채널톡 상담 링크
}

export interface CsAgent {
  name: string;
  status: CsStatusCode;
  statusLabel: string; // 대기중/상담중/자리비움/오프라인
  ongoing: number; // 진행 중 상담
  waiting: number; // 대기(미응대)
  todayHandled: number; // 오늘 처리
  online?: boolean; // 실시간 접속(채널톡 onlines)
  manual?: boolean; // 상태를 수동 지정했는지
  ongoingChats?: CsChat[];
  waitingChats?: CsChat[];
  todayChats?: CsChat[];
}

export interface CsSummary {
  waiting: number;
  ongoing: number;
  todayHandled: number;
  avgFirstResponseMin: number;
  online: number;
  total: number;
}

export interface CsData {
  updatedAt: string;
  source: string; // "channeltalk" | "mock"
  agents: CsAgent[];
  summary: CsSummary;
  lists?: { ongoing: CsChat[]; waiting: CsChat[]; today: CsChat[] };
  note?: string;
}

export async function fetchCs(): Promise<CsData> {
  const res = await fetch("/api/cs");
  if (!res.ok) throw new Error(`CS 현황 조회 실패: ${res.status}`);
  return (await res.json()) as CsData;
}

export async function syncCs(): Promise<CsData> {
  const res = await fetch("/api/cs/sync", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `동기화 실패: ${res.status}`);
  return body as CsData;
}

// 담당자 상태 수동 지정 (status: "auto"면 자동 판정으로 복귀)
export async function setCsStatus(name: string, status: CsStatusCode | "auto"): Promise<CsData> {
  const res = await fetch("/api/cs/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, status }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `상태 변경 실패: ${res.status}`);
  return body as CsData;
}
