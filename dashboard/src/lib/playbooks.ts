// 꿀팁게시판 — 가이드 Q&A(의사결정 트리) 데이터 레이어.

export interface PbOption {
  label: string;
  next: string; // 다음 노드 id
}
export interface PbNode {
  id: string;
  text: string;
  answer?: boolean; // 해결책(종료) 노드
  options?: PbOption[];
}
export interface Playbook {
  id: string;
  title: string;
  category?: string;
  rootId: string;
  nodes: Record<string, PbNode>;
  ai?: boolean; // AI 생성 여부
}
export interface PlaybooksData {
  playbooks: Playbook[];
}

export async function fetchPlaybooks(): Promise<PlaybooksData> {
  const res = await fetch("/api/playbooks");
  if (!res.ok) throw new Error(`꿀팁 조회 실패: ${res.status}`);
  return (await res.json()) as PlaybooksData;
}

export async function savePlaybooks(data: PlaybooksData): Promise<PlaybooksData> {
  const res = await fetch("/api/playbooks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `저장 실패: ${res.status}`);
  return body as PlaybooksData;
}

export async function generatePlaybooks(): Promise<{ added: number; data: PlaybooksData }> {
  const res = await fetch("/api/playbooks/generate", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `AI 생성 실패: ${res.status}`);
  return body as { added: number; data: PlaybooksData };
}
