import type { SalesRecord } from "./sales";

export interface MonthlyPoint {
  month: number; // 1~12
  thisYear: number;
  lastYear: number;
}

export interface SalesMetrics {
  // 기준 정보
  currentYear: number;
  lastYear: number;
  todayLabel: string; // "2026-06-17"
  monthsElapsed: number; // 올해 경과 개월수 (현재월 포함)

  // 금일 매출 (비교 없음)
  today: number;

  // 월간 매출 (이번 달 MTD vs 작년 같은 달 같은 기간)
  monthThis: number;
  monthLast: number;

  // 월 평균 매출 (올해 누적 ÷ 경과 개월수 vs 작년 동기간)
  avgThis: number;
  avgLast: number;

  // 년간 매출 (올해 누적 YTD vs 작년 같은 기간)
  yearThis: number;
  yearLast: number;

  // 월별 추이 (1월~현재월)
  monthly: MonthlyPoint[];
}

interface Parsed {
  y: number;
  m: number; // 0~11
  d: number;
  amount: number;
}

function parse(records: SalesRecord[]): Parsed[] {
  return records.map((r) => {
    const [y, m, d] = r.date.split("-").map(Number);
    return { y, m: m - 1, d, amount: r.amount };
  });
}

const sum = (arr: Parsed[]) => arr.reduce((acc, r) => acc + r.amount, 0);

export function computeMetrics(
  records: SalesRecord[],
  now: Date = new Date()
): SalesMetrics {
  const rows = parse(records);

  const CY = now.getFullYear();
  const PY = CY - 1;
  const CM = now.getMonth(); // 0~11
  const CD = now.getDate();
  const monthsElapsed = CM + 1;

  const todayLabel = `${CY}-${String(CM + 1).padStart(2, "0")}-${String(CD).padStart(2, "0")}`;

  // 동기간 판정: (월, 일)이 오늘 이하인가
  const withinSamePeriod = (r: Parsed) => r.m < CM || (r.m === CM && r.d <= CD);

  const today = sum(rows.filter((r) => r.y === CY && r.m === CM && r.d === CD));

  const monthThis = sum(rows.filter((r) => r.y === CY && r.m === CM && r.d <= CD));
  const monthLast = sum(rows.filter((r) => r.y === PY && r.m === CM && r.d <= CD));

  const yearThis = sum(rows.filter((r) => r.y === CY && withinSamePeriod(r)));
  const yearLast = sum(rows.filter((r) => r.y === PY && withinSamePeriod(r)));

  const avgThis = yearThis / monthsElapsed;
  const avgLast = yearLast / monthsElapsed;

  const monthly: MonthlyPoint[] = [];
  for (let m = 0; m <= CM; m++) {
    monthly.push({
      month: m + 1,
      thisYear: sum(rows.filter((r) => r.y === CY && r.m === m)),
      lastYear: sum(rows.filter((r) => r.y === PY && r.m === m)),
    });
  }

  return {
    currentYear: CY,
    lastYear: PY,
    todayLabel,
    monthsElapsed,
    today,
    monthThis,
    monthLast,
    avgThis,
    avgLast,
    yearThis,
    yearLast,
    monthly,
  };
}
