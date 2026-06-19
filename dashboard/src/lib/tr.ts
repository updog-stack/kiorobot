// 거래(TR) 현황 — 코밴 + 다우데이타 VAN별 + 합산 데이터 레이어.

export interface TrMonth {
  month: number; // 1~12
  count: number;
}

export interface TrVan {
  van: string; // "KOVAN" | "DAOUDATA"
  label: string; // "코밴" | "다우데이타"
  monthly: TrMonth[];
  total: number;
  avg: number;
  updatedAt: string | null;
}

export interface TrData {
  updatedAt: string | null;
  year: number;
  vans: TrVan[];
  combined: { monthly: TrMonth[]; total: number; avg: number };
  note?: string;
  syncWarning?: string;
}

export async function fetchTr(): Promise<TrData> {
  const res = await fetch("/api/tr");
  if (!res.ok) throw new Error(`TR 데이터 조회 실패: ${res.status}`);
  return (await res.json()) as TrData;
}

export async function syncTr(): Promise<TrData> {
  const res = await fetch("/api/tr/sync", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `동기화 실패: ${res.status}`);
  return body as TrData;
}
