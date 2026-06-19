// 무실적 가맹점 — 코밴 + 다우데이타 VAN별 + 합산 데이터 레이어.

export interface BizStatus {
  b_stt: string; // "계속사업자" | "휴업자" | "폐업자" | ""
  b_stt_cd: string; // "01" | "02" | "03" | ""
  end_dt: string; // 폐업일자 (YYYYMMDD) 있을 때
}

export interface InactiveStore {
  bizNo: string;
  storeName: string;
  daepojeomName?: string;
  van?: string; // "코밴" | "다우데이타"
  status?: BizStatus | null; // 국세청 사업자상태 (조회 후)
  phone?: string; // 연락처 (다우데이타, 포털 마스킹)
  lastYearSales?: number | null; // 작년(2025) 매출 금액
}

export interface InactiveVan {
  van: string; // "KOVAN" | "DAOUDATA"
  label: string; // "코밴" | "다우데이타"
  updatedAt: string | null;
  baseDate: string | null;
  count: number;
  uniqueBizCount: number;
  stores: InactiveStore[];
}

export interface InactiveData {
  updatedAt: string | null;
  vans: InactiveVan[];
  combinedCount: number;
  combinedUniqueBiz: number;
  statusCheckedAt?: string | null; // 국세청 조회 시각
  closedCount?: number; // 폐업 건수
  lastYearSalesYear?: number | null; // 작년 매출 기준연도
  note?: string;
  syncWarning?: string;
}

export async function fetchInactive(): Promise<InactiveData> {
  const res = await fetch("/api/inactive");
  if (!res.ok) throw new Error(`무실적 가맹점 조회 실패: ${res.status}`);
  return (await res.json()) as InactiveData;
}

export async function syncInactive(): Promise<InactiveData> {
  const res = await fetch("/api/inactive/sync", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `동기화 실패: ${res.status}`);
  return body as InactiveData;
}

// 국세청 사업자상태(폐업여부) 조회
export async function checkInactive(): Promise<InactiveData> {
  const res = await fetch("/api/inactive/check", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `조회 실패: ${res.status}`);
  return body as InactiveData;
}

// 사업자상태 표시용 라벨/톤
export function statusLabel(s?: { b_stt_cd?: string; b_stt?: string; end_dt?: string } | null): {
  text: string;
  tone: "ok" | "warn" | "danger" | "muted";
} {
  if (!s) return { text: "미조회", tone: "muted" };
  switch (s.b_stt_cd) {
    case "01":
      return { text: "정상", tone: "ok" };
    case "02":
      return { text: "휴업", tone: "warn" };
    case "03":
      return { text: s.end_dt ? `폐업 (${s.end_dt})` : "폐업", tone: "danger" };
    default:
      return { text: "미등록", tone: "muted" };
  }
}
