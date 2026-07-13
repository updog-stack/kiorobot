// 단말기 사용현황(개통/사용/미사용) — terminal-usage-scraper 수집분
export interface IdleTerminal {
  tid: string; // 단말기번호
  bizno: string; // 사업자번호
  name: string; // 상호명(가맹점명)
}
export interface VanTerminals {
  opened: number; // 개통(활성) 단말기
  used: number; // 최근 7일 결제 있는 단말기
  idle: number; // 미사용 — 7일 이상 미결제
  idleList?: IdleTerminal[]; // 미사용 단말기 명단(상호/사업자번호). 다우는 다인 직접관리 범위
  basis: string; // 집계 기준 설명
  precise: boolean; // 정밀 7일 여부(false=월 근사)
  error?: string;
}
// 가맹점(사업자번호 distinct) 수 — 개통/사용(최근 7일)/미사용
export interface MerchCount {
  opened: number;
  used: number;
  idle: number;
}
export interface IdleMerchant {
  bizno: string; // 사업자번호
  name: string; // 상호명
}
export interface MerchantsSummary {
  basis?: string;
  kovan: MerchCount | null;
  ddwm: MerchCount | null;
  kicc?: number; // KICC 가맹점 수(단말기 미수집 · 수기 반영)
  combined: MerchCount; // 코밴+다우 중복 제거 + KICC
  idleList?: IdleMerchant[]; // 미사용 가맹점(7일 미결제) 명단 — 상호/사업자번호
}
export interface TerminalUsage {
  updatedAt: string | null;
  kovan: VanTerminals | null;
  ddwm: VanTerminals | null;
  merchants?: MerchantsSummary;
  note?: string;
}

export async function fetchTerminals(): Promise<TerminalUsage> {
  const r = await fetch("/api/terminals");
  if (!r.ok) throw new Error("terminals " + r.status);
  return (await r.json()) as TerminalUsage;
}

// 국세청 사업자상태(계속/휴업/폐업) — 임의 사업자번호 목록 조회
export interface BizStatus {
  b_stt: string; // 계속사업자 | 휴업자 | 폐업자 | ""
  b_stt_cd: string; // 01 | 02 | 03
  end_dt: string; // 폐업일 YYYYMMDD
}
export async function fetchBizStatus(bizNos: string[]): Promise<Record<string, BizStatus>> {
  const r = await fetch("/api/biz-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bizNos }),
  });
  if (!r.ok) return {};
  const j = await r.json();
  return (j.status ?? {}) as Record<string, BizStatus>;
}
