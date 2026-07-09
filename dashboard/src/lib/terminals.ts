// 단말기 사용현황(개통/사용/미사용) — terminal-usage-scraper 수집분
export interface VanTerminals {
  opened: number; // 개통(활성) 단말기
  used: number; // 최근 7일 결제 있는 단말기
  idle: number; // 미사용(휴면) — 7일 이상 미결제
  basis: string; // 집계 기준 설명
  precise: boolean; // 정밀 7일 여부(false=월 근사)
  error?: string;
}
export interface TerminalUsage {
  updatedAt: string | null;
  kovan: VanTerminals | null;
  ddwm: VanTerminals | null;
  note?: string;
}

export async function fetchTerminals(): Promise<TerminalUsage> {
  const r = await fetch("/api/terminals");
  if (!r.ok) throw new Error("terminals " + r.status);
  return (await r.json()) as TerminalUsage;
}
