// 당근마켓 광고현황 — 상주 데몬(daangn-ads-daemon) 수집분

// 광고 그룹 안의 개별 광고(소재).
// 목록 페이지에는 클릭률만 나오므로 노출·클릭·지출은 없다(그룹 상세에만 있음).
// 노출이 0이면 클릭률 줄 자체가 없어 ctr 이 null 이 된다.
export interface DaangnCreative {
  name: string;
  status: string; // ON | OFF
  ctr: number | null;
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
