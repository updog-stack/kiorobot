// 당근마켓 광고캐시 사용 내역 — /finances(광고캐시 내역) 수집분.
//   거래는 서버에서 id 기준 누적 저장된다(매 수집이 최소 이번 달을 담고, 과거 달은 보존).

export interface CashTx {
  id: string;
  ts: string | null; // ISO(UTC) 발생시각
  date: string | null; // 한국 날짜 YYYY-MM-DD (당근 화면 표기와 동일)
  title: string; // "광고캐시 사용" | "무상캐시 충전" | "유상캐시 충전" …
  type: string; // CHARGED_AD | CHARGE_GIFT | CHARGE_CASH …
  description: string; // "광고 집행" | "캐시백 혜택" …
  amount: number; // 절대값(원)
  direction: number; // +1 충전 / -1 사용
  signed: number; // direction * amount
}

export interface CashBalance {
  paid: number; // 유상 캐시
  free: number; // 무상 캐시
  total: number; // 총 캐시
}

export interface DaangnCash {
  updatedAt: string | null;
  advertiserId?: string;
  balance: CashBalance | null;
  transactions: CashTx[];
  note?: string;
  loggedOut?: boolean;
  error?: string;
}

export async function fetchDaangnCash(): Promise<DaangnCash> {
  const r = await fetch("/api/daangn-cash");
  if (!r.ok) throw new Error("daangn-cash " + r.status);
  const d = (await r.json()) as DaangnCash;
  if (!Array.isArray(d.transactions)) d.transactions = [];
  return d;
}

// ── 주별·월별 집계 ─────────────────────────────────────────────
export interface Bucket {
  key: string; // 정렬용 키
  label: string; // 표시용
  usage: number; // 사용 합계(양수)
  charge: number; // 충전 합계(양수)
  net: number; // 순증감(충전 - 사용)
  count: number; // 거래 건수
}

function addTx(b: Bucket, t: CashTx) {
  if (t.direction < 0) b.usage += t.amount;
  else b.charge += t.amount;
  b.net += t.signed;
  b.count += 1;
}

// 월별 — 최신 달이 위로.
export function byMonth(txs: CashTx[]): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const t of txs) {
    if (!t.date) continue;
    const key = t.date.slice(0, 7); // YYYY-MM
    const label = `${key.slice(0, 4)}년 ${+key.slice(5, 7)}월`;
    let b = m.get(key);
    if (!b) { b = { key, label, usage: 0, charge: 0, net: 0, count: 0 }; m.set(key, b); }
    addTx(b, t);
  }
  return [...m.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

// 날짜 문자열(YYYY-MM-DD)을 UTC Date 로(요일·주 계산은 표준시 무관하게 날짜만 다룬다).
function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtMD(dt: Date): string {
  return `${dt.getUTCMonth() + 1}.${dt.getUTCDate()}`;
}

// 주별(월~일) — 최신 주가 위로. 라벨은 "M.D~M.D".
export function byWeek(txs: CashTx[]): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const t of txs) {
    if (!t.date) continue;
    const dt = parseYMD(t.date);
    const dow = (dt.getUTCDay() + 6) % 7; // 월=0
    const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - dow);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    const key = mon.toISOString().slice(0, 10);
    const label = `${fmtMD(mon)}~${fmtMD(sun)}`;
    let b = m.get(key);
    if (!b) { b = { key, label, usage: 0, charge: 0, net: 0, count: 0 }; m.set(key, b); }
    addTx(b, t);
  }
  return [...m.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}
