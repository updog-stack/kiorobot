// CMS 매출(효성CMS 월별 수납/완납액) 데이터 레이어 — BFF /api/cms.

export interface CmsData {
  curYear: number;
  prevYear: number;
  cur: number[] | null; // 올해 월별 완납(수납)액 — 수집된 월까지
  prev: number[] | null; // 작년 월별 완납액(12개)
  updatedAt: string | null;
  source: string;
  note?: string;
}

export async function fetchCms(): Promise<CmsData> {
  const res = await fetch("/api/cms");
  if (!res.ok) throw new Error(`CMS 조회 실패: ${res.status}`);
  return (await res.json()) as CmsData;
}
