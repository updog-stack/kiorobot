// 꿀팁게시판 — 가이드 Q&A(의사결정 트리) 데이터 레이어.

export interface PbOption {
  label: string;
  next: string; // 다음 노드 id
}
export type MediaType = "image" | "youtube" | "text";
export interface MediaItem {
  type: MediaType;
  value: string; // image: URL · youtube: 링크/ID · text: 내용
  caption?: string;
}
export interface PbNode {
  id: string;
  text: string;
  answer?: boolean; // 해결책(종료) 노드
  options?: PbOption[];
  media?: MediaItem[]; // 첨부 자료(사진·유튜브·텍스트)
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

export interface GenerateBasis {
  days: number;
  totalChats: number;
  sampled?: number; // AI가 실제로 읽고 분류한 표본 건수
  topics: { tag: string; count: number }[];
}
export interface GenerateResult {
  added: number;
  data: PlaybooksData;
  basis?: GenerateBasis;
}

// 사진 업로드 → 서버 저장 후 URL 반환
export async function uploadImage(file: File): Promise<string> {
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mediaType: file.type, data }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `업로드 실패: ${res.status}`);
  return body.url as string;
}

// 유튜브 링크/ID → 임베드용 video id 추출
export function youtubeId(input: string): string | null {
  const s = (input || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s; // 이미 ID
  const m = s.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

// days: 분석 기간(일), minCount: 플레이북으로 만들 최소 반복 건수
export async function generatePlaybooks(
  days = 60,
  minCount = 3
): Promise<GenerateResult> {
  const res = await fetch("/api/playbooks/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days, minCount }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `AI 생성 실패: ${res.status}`);
  return body as GenerateResult;
}
