// 당근마켓 광고현황 — 상주 데몬(daangn-ads-daemon) 수집분
export interface DaangnAd {
  type: string; // 디스플레이 | 검색
  status: string; // ON | OFF
  name: string;
  dailyBudget: number;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
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
