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

/** 2025년~ 다년도 월별 시리즈 — 건수(코밴/다우/합산) + VAN별 금액 */
export interface TrSeries {
  months: string[]; // "2025-01" … 시간순
  kovanCount: number[];
  ddwmCount: number[];
  totalCount: number[];
  ddwmAmount: number[]; // 원
  kovanAmount?: number[]; // 원 — 실측(신용+체크 카드, 100만원 초과 절삭·1천원 이하 제외 근사). 미수집 월은 0
  kovanAmountFilled?: number[]; // 원 — 실측 + 미수집 월은 '건수 × 평균단가' 추정치로 채움
  kovanAmountEst?: boolean[]; // 해당 월이 추정치인지
}

export interface TrData {
  updatedAt: string | null;
  year: number;
  years?: number[];
  vans: TrVan[];
  combined: { monthly: TrMonth[]; total: number; avg: number };
  series?: TrSeries;
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

// /api/tr → 특정 VAN(코밴 kovanCount / 다우 ddwmCount)의 올해·작년 12개월 배열 + 데이터 있는 마지막 달
export function trMonthly(
  tr: TrData,
  key: "kovanCount" | "ddwmCount"
): { cur12: number[]; prev12: number[]; lastMonth: number } {
  const s = tr.series;
  const curYear = tr.year;
  const mk = (yr: number) => {
    const arr = Array(12).fill(0);
    s?.months.forEach((m, i) => {
      if (m.startsWith(yr + "-")) arr[Number(m.slice(5, 7)) - 1] = s[key][i] ?? 0;
    });
    return arr;
  };
  const cur12 = mk(curYear);
  let lastMonth = 0;
  for (let i = 0; i < 12; i++) if (cur12[i] > 0) lastMonth = i + 1;
  return { cur12, prev12: mk(curYear - 1), lastMonth };
}
