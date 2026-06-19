// 한국식 금액 표기: 123,450,000 → "1억 2,345만원"
export function won(value: number): string {
  const sign = value < 0 ? "-" : "";
  let n = Math.abs(Math.round(value));
  if (n === 0) return "0원";

  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const rest = n % 10_000;

  const parts: string[] = [];
  if (eok) parts.push(`${eok.toLocaleString("ko-KR")}억`);
  if (man) parts.push(`${man.toLocaleString("ko-KR")}만`);
  // 만 단위 이상이 있으면 원 단위 잔돈은 생략(가독성)
  if (rest && !eok && !man) parts.push(`${rest.toLocaleString("ko-KR")}`);

  return `${sign}${parts.join(" ")}원`;
}

export type GrowthTone = "up" | "down" | "flat" | "muted";

export interface Growth {
  text: string; // "+18.3%"
  tone: GrowthTone;
  ratio: number | null; // 0.183
}

// 성장률: (이번값 - 작년값) / 작년값
export function growth(current: number, previous: number | null): Growth {
  if (previous == null || previous === 0) {
    return { text: "비교 불가", tone: "muted", ratio: null };
  }
  const ratio = (current - previous) / previous;
  const pct = ratio * 100;
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const tone: GrowthTone = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return { text, tone, ratio };
}
