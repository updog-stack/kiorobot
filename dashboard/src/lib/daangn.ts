// 당근마켓 광고현황 — 상주 데몬(daangn-ads-daemon) 수집분

// 광고 그룹 안의 개별 광고(소재). 그룹 상세 페이지에서 소재별 지표를 받아온다.
// 상세 수집에 실패했거나 예전 수집분이면 지표 없이 이름·상태·클릭률만 있을 수 있다.
export interface DaangnCreative {
  name: string;
  status: string; // ON | OFF
  ctr: number | null;
  impressions?: number;
  clicks?: number;
  spend?: number;
}

export interface DaangnAd {
  type: string; // 디스플레이 | 검색
  status: string; // ON | OFF
  name: string;
  dailyBudget: number;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  creatives?: DaangnCreative[]; // 예전 수집분에는 없음
}
export interface DaangnAds {
  updatedAt: string | null;
  advertiserId?: string;
  cash: number | null;
  period?: string;
  ads: DaangnAd[];
  total?: { impressions: number; clicks: number; spend: number; ctr: number };
  note?: string;
  error?: string;
  loggedOut?: boolean;
}

export async function fetchDaangnAds(): Promise<DaangnAds> {
  const r = await fetch("/api/daangn-ads");
  if (!r.ok) throw new Error("daangn-ads " + r.status);
  return (await r.json()) as DaangnAds;
}
