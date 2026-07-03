// 상담 기록 검색 — 인덱스 + AI 원포인트 답변 데이터 레이어.

export interface CsSource {
  id: string;
  date: string | null;
  tags: string[];
  name: string | null;
  text: string;
  url: string | null;
  used?: boolean; // AI가 답변에 참고한 기록
}

export interface CsSearchResult {
  query: string;
  answer: string;
  steps: string[];
  confidence: "high" | "medium" | "low" | "none";
  sources: CsSource[];
  note?: string;
}

export interface CsIndexMeta {
  exists: boolean;
  lastBuilt?: string;
  from?: string | null; // 수집한 기간(시작) ISO
  to?: string | null; // 수집한 기간(끝) ISO
  count?: number;
  // 아래는 '수집' 직후 응답에만 포함되는 결과 요약
  added?: number; // 이번에 새로 모은 건수
  skipped?: number; // 이미 있어 건너뛴 건수(중복 방지)
  inRange?: number; // 기간 안 종료 상담 총수
  truncated?: number; // 한도 초과로 못 모은 신규 건수
}

export async function getCsIndex(): Promise<CsIndexMeta> {
  const res = await fetch("/api/cs-index");
  if (!res.ok) throw new Error(`인덱스 조회 실패: ${res.status}`);
  return (await res.json()) as CsIndexMeta;
}

// 지정 기간(from~to, YYYY-MM-DD)의 상담을 수집. 이미 모은 상담은 서버가 건너뜀(중복 방지).
// limit: 한 번에 모을 최대 건수(청크). 프론트가 truncated=0까지 반복 호출해 사실상 무제한 수집.
export async function collectCsIndex(from: string, to: string, limit?: number): Promise<CsIndexMeta> {
  const res = await fetch("/api/cs-index/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limit ? { from, to, limit } : { from, to }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `수집 실패: ${res.status}`);
  return body as CsIndexMeta;
}

export async function searchCs(query: string): Promise<CsSearchResult> {
  const res = await fetch("/api/cs-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `검색 실패: ${res.status}`);
  return body as CsSearchResult;
}
