// 재고현황(이카운트 ECount 창고별 현재고) 데이터 레이어 — BFF /api/inventory.

export interface InvWarehouse {
  code: string; // 창고코드 (예: "100", "00001")
  name: string; // 창고명 (예: "본사창고")
}

export interface InvItem {
  prodCd: string; // 품목코드
  prodDes: string; // 품목명
  size: string; // 규격
  unit: string; // 단위
  total: number; // 총 재고수량
  safeQty: number; // 안전재고
  byWh: Record<string, number>; // 창고코드 → 재고수량
}

export interface InventoryData {
  updatedAt: string | null;
  baseDate?: string; // 기준일 YYYYMMDD
  warehouses: InvWarehouse[];
  items: InvItem[];
  itemCount: number;
  totalQty: number;
  byWhTotal?: Record<string, number>; // 창고코드 → 총합
  note?: string;
  syncWarning?: string;
}

export async function fetchInventory(): Promise<InventoryData> {
  const res = await fetch("/api/inventory");
  if (!res.ok) throw new Error(`재고현황 조회 실패: ${res.status}`);
  return (await res.json()) as InventoryData;
}

// 수량 표기: 정수면 그대로, 소수면 최대 3자리.
export function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n)
    ? n.toLocaleString("ko-KR")
    : n.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
}
