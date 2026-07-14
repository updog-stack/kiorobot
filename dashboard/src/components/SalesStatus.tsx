import { useEffect, useMemo, useState } from "react";
import { fetchTr, type TrData } from "../lib/tr";
import { fetchSalesMonthly, type SalesMonthly } from "../lib/sales";
import { TotalSalesChart } from "./Overview";
import { TrTrend, CmsSection } from "./TrMetrics";

// 매출현황 — 흩어져 있던 매출 데이터를 한 메뉴로 통합(중복 제거).
//   · 총매출(장비·라이선스·기타, 노션)  · VAN 결제금액(코밴+다우, 가맹점 거래대금 참고)  · CMS 매출(효성CMS 수납액)
//   · 아무도없개 매출(결제건수·금액, 월별 실데이터)
export function SalesStatus() {
  const [sales, setSales] = useState<SalesMonthly | null>(null);
  const [tr, setTr] = useState<TrData | null>(null);
  useEffect(() => {
    fetchSalesMonthly().then(setSales).catch(() => {});
    fetchTr().then(setTr).catch(() => {});
  }, []);

  return (
    <div className="sales" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="ov__banner">
        회사 매출 통합 — 총매출(제품)·CMS 수납·VAN 결제금액을 한 곳에서
        <span>· 총매출·CMS는 다인 매출, VAN 결제금액은 가맹점 거래대금(참고)</span>
      </div>

      {/* 1) 총매출 (장비·라이선스·기타) */}
      <div className="ov__sec-h" style={{ marginTop: 8 }}>
        <h2>총매출</h2>
        <span>장비·라이선스·기타 (노션 · 구분 선택)</span>
      </div>
      <TotalSalesChart curByCat={sales?.curByCat ?? null} lastMonth={sales?.lastMonth ?? 0} />

      {/* 2) VAN 결제금액 (금액만 — 건수는 거래현황 전용) */}
      <TrTrend series={tr?.series} years={tr?.years} amountOnly />

      {/* 3) CMS 매출 (효성CMS 수납액) */}
      <CmsSection />

      {/* 4) 아무도없개 매출 (결제건수·금액) */}
      <AmudoSales />
    </div>
  );
}

// ───────── 아무도없개 매출(결제건수·금액) — 월별 [1월..12월] ─────────
//   2024-11 ~ 2026-05: 정적 데이터(수기). 2026-06~: 코밴 fixedrate에서 자동 수집(/api/amudo-sales)해 병합.
const AMUDO_COUNT: Record<number, number[]> = {
  2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7153, 55697],
  2025: [64821, 56558, 65120, 63133, 69801, 68500, 79945, 84149, 78865, 84293, 73503, 69400],
  2026: [65179, 62609, 61527, 62200, 68996, 0, 0, 0, 0, 0, 0, 0],
};
const AMUDO_AMOUNT: Record<number, number[]> = {
  2024: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87479520, 695500605],
  2025: [827838010, 703676637, 820211830, 791288094, 861462130, 835908561, 966034693, 981168203, 911017278, 1006938029, 875740843, 841326008],
  2026: [796642705, 770749835, 748745388, 761104879, 864710092, 0, 0, 0, 0, 0, 0, 0],
};
const ko = (n: number) => n.toLocaleString("ko-KR");
const asum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const dataMonths = (a: number[]) => a.filter((v) => v > 0).length;
const firstMonth = (a: number[]) => a.findIndex((v) => v > 0);        // 0-based
const lastMonth = (a: number[]) => a.reduce((l, v, i) => (v > 0 ? i + 1 : l), 0); // 1-based

interface AmudoMonths { months: Record<string, { count: number; amount: number; partial?: boolean }> }

// 정적 데이터 + 수집분(2026-06~) 병합 → { count, amount, years, partialYm }
function mergeAmudo(scraped: AmudoMonths | null) {
  const count: Record<number, number[]> = {};
  const amount: Record<number, number[]> = {};
  for (const y of [2024, 2025, 2026]) { count[y] = [...AMUDO_COUNT[y]]; amount[y] = [...AMUDO_AMOUNT[y]]; }
  let partialYm = "";
  for (const [ym, v] of Object.entries(scraped?.months ?? {})) {
    const [y, m] = ym.split("-").map(Number);
    if (!count[y]) { count[y] = Array(12).fill(0); amount[y] = Array(12).fill(0); }
    count[y][m - 1] = v.count; amount[y][m - 1] = v.amount;
    if (v.partial) partialYm = ym;
  }
  const years = Object.keys(count).map(Number).sort((a, b) => a - b);
  return { count, amount, years, partialYm };
}

// 축 눈금(금액=억/만, 건수=만/건)
function niceMax(v: number) {
  const rough = Math.max(1, v) / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = (n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 5 ? 5 : 10) * pow;
  return { max: step * 4, step };
}
const fmtAxis = (v: number, isAmt: boolean) => {
  if (v === 0) return "0";
  if (isAmt) return v >= 1e8 ? (v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1) + "억" : Math.round(v / 1e4).toLocaleString("ko-KR") + "만";
  return v >= 1e4 ? Math.round(v / 1e4).toLocaleString("ko-KR") + "만" : Math.round(v).toLocaleString("ko-KR");
};

// 단일 연도 월별 막대(하나의 지표) — 좌측 눈금 + 격자선
function YearBars({ values, months, isAmt }: { values: number[]; months: string[]; isAmt: boolean }) {
  const dataMax = Math.max(1, ...values);
  const { max, step } = niceMax(dataMax);
  const ticks = Array.from({ length: 5 }, (_, i) => step * i);
  return (
    <>
      <div className="mchart">
        <div className="mchart__y">
          {ticks.slice().reverse().map((t) => <span className="mchart__ytick" key={t}>{fmtAxis(t, isAmt)}</span>)}
        </div>
        <div className="mchart__body">
          <div className="mchart__plot">
            {ticks.map((t) => <div className="mchart__grid" key={t} style={{ bottom: `${(t / max) * 100}%` }} />)}
            <div className="mchart__bars">
              {values.map((v, i) => (
                <div className="mchart__col" key={i}>
                  <div
                    className="mchart__bar"
                    style={{ height: `${(v / max) * 100}%`, background: "var(--brand)" }}
                    title={`${months[i]}: ${isAmt ? ko(v) + "원" : ko(v) + "건"}`}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="mchart__x">
            {months.map((m, i) => <span className="mchart__xtick" key={i}>{m}</span>)}
          </div>
        </div>
      </div>
    </>
  );
}

function AmudoSales() {
  const [metric, setMetric] = useState<"amount" | "count">("amount");
  const [scraped, setScraped] = useState<AmudoMonths | null>(null);
  const [year, setYear] = useState<number>(2026);
  useEffect(() => {
    fetch("/api/amudo-sales").then((r) => (r.ok ? r.json() : null)).then(setScraped).catch(() => {});
  }, []);
  const { count, amount, years, partialYm } = useMemo(() => mergeAmudo(scraped), [scraped]);
  const isAmt = metric === "amount";
  const [py, pm] = partialYm ? partialYm.split("-").map(Number) : [0, 0];
  const yearLabel = (y: number) => {
    const a = amount[y] ?? [];
    if (dataMonths(a) === 12) return `${y}년`;
    return `${y}년(${firstMonth(a) + 1}~${lastMonth(a)}월)`;
  };
  const arr = (isAmt ? amount : count)[year] ?? [];
  const f = firstMonth(arr), l = lastMonth(arr);
  const values = arr.slice(f, l);
  const months = Array.from({ length: l - f }, (_, i) => { const mo = f + 1 + i; return `${mo}월${year === py && mo === pm ? "*" : ""}`; });

  return (
    <>
      <div className="ov__sec-h" style={{ marginTop: 8 }}>
        <h2>아무도없개 매출</h2>
        <span>결제건수·결제금액 · 연도 선택 · 2026-06~ 코밴 자동수집(가맹점명 "아무도없개")</span>
      </div>

      <section className="card card--wide">
        <div className="ov__chart-head">
          <h2 className="card__title">
            아무도없개 {isAmt ? "결제금액" : "결제건수"} — {yearLabel(year)}{" "}
            <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>(월별)</span>
          </h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="seg">
              <button className={isAmt ? "is-active" : ""} onClick={() => setMetric("amount")}>금액</button>
              <button className={!isAmt ? "is-active" : ""} onClick={() => setMetric("count")}>건수</button>
            </div>
            <div className="seg">
              {years.map((y) => (
                <button key={y} className={year === y ? "is-active" : ""} onClick={() => setYear(y)}>{y}년</button>
              ))}
            </div>
          </div>
        </div>
        <YearBars values={values} months={months} isAmt={isAmt} />

        {/* 연도별 요약 */}
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table className="amudo-table">
            <thead>
              <tr><th>연도</th><th>결제건수</th><th>결제금액</th><th>월평균 건수</th><th>월평균 금액</th></tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const c = asum(count[y]), a = asum(amount[y]), mn = dataMonths(amount[y]) || 1;
                return (
                  <tr key={y} style={y === year ? { background: "color-mix(in srgb, var(--brand) 10%, transparent)" } : undefined}>
                    <td>{yearLabel(y)}</td>
                    <td>{ko(c)}건</td>
                    <td>{ko(a)}원</td>
                    <td>{ko(Math.round(c / mn))}건</td>
                    <td>{ko(Math.round(a / mn))}원</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {partialYm && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>* {partialYm} 진행 중(어제까지) · 매일 자동 갱신</div>}
      </section>
    </>
  );
}
