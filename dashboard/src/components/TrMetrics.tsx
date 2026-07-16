import { useMemo, useState, useEffect, type CSSProperties } from "react";
import { fetchTr, syncTr, type TrData, type TrMonth, type TrVan, type TrSeries, type AmudoMonth } from "../lib/tr";
import { kicc as kiccSeries, cms as cmsSeries, YEAR, PREV_YEAR, KICC_AMOUNT } from "../lib/overview";
import { fetchCms } from "../lib/cms";
import { won, growth } from "../lib/format";
import { MonthBars } from "./Overview";

const cnt = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}건`;
const sumArr = (a: number[]) => a.reduce((x, y) => x + y, 0);

// 자동수집되지 않는 KICC(구글시트 참고값)를 정적 VAN으로 추가하고 합산에 반영
function augment(data: TrData): TrData {
  const kiccMonthly: TrMonth[] = kiccSeries.cur.map((count, i) => ({
    month: i + 1,
    count,
  }));
  const kiccTotal = sumArr(kiccSeries.cur);
  const kiccVan: TrVan = {
    van: "KICC",
    label: "KICC (참고)",
    monthly: kiccMonthly,
    total: kiccTotal,
    avg: kiccMonthly.length ? kiccTotal / kiccMonthly.length : 0,
    updatedAt: null,
  };

  const m = new Map<number, number>();
  for (const x of data.combined.monthly) m.set(x.month, x.count);
  for (const x of kiccMonthly) m.set(x.month, (m.get(x.month) || 0) + x.count);
  const monthly = [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, count]) => ({ month, count }));
  const total = sumArr(monthly.map((x) => x.count));

  return {
    ...data,
    vans: [...data.vans, kiccVan],
    combined: { monthly, total, avg: monthly.length ? total / monthly.length : 0 },
  };
}

export function TrMetrics() {
  const [data, setData] = useState<TrData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [scope, setScope] = useState("all"); // "all" | van | "DAIN" | "AMUDO"

  useEffect(() => {
    let alive = true;
    fetchTr()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const aug = useMemo(() => (data ? augment(data) : null), [data]);

  // 아무도없개(코밴+다우 매장명 매칭분) — 올해 월별 건수·금액. /api/tr 응답에 실려옴(별도 요청 캐시 방지). 다인 = 합산 − 아무도없개.
  const amudoByMonth = useMemo(() => {
    const c = new Map<number, number>(), a = new Map<number, number>();
    const yr = data?.year;
    if (data?.amudoMonths && yr) {
      for (const [ym, v] of Object.entries(data.amudoMonths)) {
        if (!ym.startsWith(`${yr}-`)) continue;
        const mo = Number(ym.slice(5, 7));
        c.set(mo, v.count || 0); a.set(mo, v.amount || 0);
      }
    }
    return { c, a };
  }, [data]);
  const amudoTotal = useMemo(() => [...amudoByMonth.c.values()].reduce((s, x) => s + x, 0), [amudoByMonth]);
  const hasAmudo = amudoTotal > 0;

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      setData(await syncTr());
    } catch (e) {
      setSyncError(String(e instanceof Error ? e.message : e));
    } finally {
      setSyncing(false);
    }
  }

  const view = useMemo(() => {
    if (!aug) return { monthly: [] as TrMonth[], total: 0, avg: 0 };
    if (scope === "all") return aug.combined;
    if (scope === "AMUDO" || scope === "DAIN") {
      const monthly = aug.combined.monthly.map((m) => {
        const am = amudoByMonth.c.get(m.month) ?? 0;
        return { month: m.month, count: scope === "AMUDO" ? am : Math.max(0, m.count - am) };
      });
      const total = monthly.reduce((s, x) => s + x.count, 0);
      return { monthly, total, avg: monthly.length ? total / monthly.length : 0 };
    }
    const v = aug.vans.find((x) => x.van === scope);
    return v
      ? { monthly: v.monthly, total: v.total, avg: v.avg }
      : { monthly: [], total: 0, avg: 0 };
  }, [aug, scope, amudoByMonth]);

  // 선택 VAN(scope)의 현재 연도 월별 결제금액 — series(코밴/다우) + KICC 정적값
  const amtByMonth = useMemo(() => {
    const map = new Map<number, number>();
    const s = data?.series;
    const yr = data?.year;
    if (!s || !yr) return map;
    s.months.forEach((ym, i) => {
      if (!ym.startsWith(`${yr}-`)) return;
      const mo = Number(ym.slice(5, 7));
      const kov = s.kovanAmountFilled?.[i] ?? s.kovanAmount?.[i] ?? 0;
      const dao = s.ddwmAmount?.[i] ?? 0;
      const kic = KICC_AMOUNT[yr]?.[mo - 1] ?? 0;
      const amu = amudoByMonth.a.get(mo) ?? 0;
      const v =
        scope === "all" ? kov + dao + kic
        : scope === "KOVAN" ? kov
        : scope === "DAOUDATA" ? dao
        : scope === "KICC" ? kic
        : scope === "AMUDO" ? amu
        : scope === "DAIN" ? Math.max(0, kov + dao + kic - amu)
        : 0;
      map.set(mo, v);
    });
    return map;
  }, [data, scope, amudoByMonth]);

  const syncButton = (
    <button className="sync-btn" onClick={handleSync} disabled={syncing}>
      {syncing ? "동기화 중…" : "↻ 지금 동기화"}
    </button>
  );

  if (error)
    return (
      <div className="sales">
        <div className="sales__toolbar">{syncButton}</div>
        <div className="state state--error">불러오기 실패: {error}</div>
      </div>
    );
  if (!data || !aug) return <div className="state">TR현황 데이터를 불러오는 중…</div>;

  const currentMonth = view.monthly.length ? view.monthly[view.monthly.length - 1] : null;
  // 금액 집계(선택 VAN)
  const amtTotal = view.monthly.reduce((s, m) => s + (amtByMonth.get(m.month) ?? 0), 0);
  const amtAvg = view.monthly.length ? amtTotal / view.monthly.length : 0;
  const thisMonthAmt = currentMonth ? amtByMonth.get(currentMonth.month) ?? 0 : 0;
  const amtMonthly = view.monthly.map((m) => ({ month: m.month, amount: amtByMonth.get(m.month) ?? 0 }));
  const dainTotal = Math.max(0, aug.combined.total - amudoTotal);
  const scopeLabel =
    scope === "all" ? "합산(코밴+다우데이타+KICC)"
    : scope === "AMUDO" ? "아무도없개(코밴+다우 매장명 기준)"
    : scope === "DAIN" ? "다인(전체 − 아무도없개)"
    : aug.vans.find((v) => v.van === scope)?.label ?? scope;

  // 차트 헤더 드롭다운(상단 탭과 같은 scope 공유 — 어느 쪽을 바꿔도 전체 연동)
  const scopeOptions = [
    { v: "all", label: "합산" },
    ...aug.vans.map((v) => ({ v: v.van, label: v.label })),
    ...(hasAmudo ? [{ v: "DAIN", label: "다인" }, { v: "AMUDO", label: "아무도없개" }] : []),
  ];
  const scopeSelect = (
    <select
      value={scope}
      onChange={(e) => setScope(e.target.value)}
      style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, padding: "5px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", cursor: "pointer" }}
      title="이 필터는 상단 탭과 연동됩니다"
    >
      {scopeOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );

  return (
    <div className="sales">
      <div className="sales__toolbar">
        {data.updatedAt && (
          <span className="sales__updated">
            수집 {new Date(data.updatedAt).toLocaleString("ko-KR")}
          </span>
        )}
        {syncButton}
      </div>

      {syncError && <div className="state state--error">동기화 실패: {syncError}</div>}
      {data.syncWarning && <div className="state state--error">일부 실패: {data.syncWarning}</div>}
      {syncing && <div className="state">로그인 → 조회 중… (다우데이타는 이메일 인증·월별 조회로 1~2분 소요)</div>}

      <div className="van-tabs">
        <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>
          합산 ({cnt(aug.combined.total)})
        </button>
        {aug.vans.map((v) => (
          <button key={v.van} className={scope === v.van ? "is-active" : ""} onClick={() => setScope(v.van)}>
            {v.label} ({cnt(v.total)})
          </button>
        ))}
        {hasAmudo && (
          <>
            <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "4px 2px" }} />
            <button className={scope === "DAIN" ? "is-active" : ""} onClick={() => setScope("DAIN")} title="전체 − 아무도없개">
              🏢 다인 ({cnt(dainTotal)})
            </button>
            <button className={scope === "AMUDO" ? "is-active" : ""} onClick={() => setScope("AMUDO")} title="코밴 매장명에 '아무도없개' 포함(오타·띄어쓰기 변형 포함)">
              🍦 아무도없개 ({cnt(amudoTotal)})
            </button>
          </>
        )}
      </div>

      <div className="sales__kpis">
        <section className="metric">
          <div className="metric__label">총합 건수</div>
          <div className="metric__amount">{cnt(view.total)}</div>
          <div className="metric__hint">
            {data.year}년 1월~{currentMonth ? `${currentMonth.month}월` : "현재"} ·{" "}
            {scope === "all" ? "코밴+다우데이타+KICC" : scope === "AMUDO" ? "아무도없개(코밴+다우)" : scope === "DAIN" ? "다인(전체−아무도없개)" : scope}
          </div>
        </section>
        <section className="metric">
          <div className="metric__label">월 평균 건수</div>
          <div className="metric__amount">{cnt(view.avg)}</div>
          <div className="metric__hint">{view.monthly.length}개월 평균</div>
        </section>
        <section className="metric">
          <div className="metric__label">이번달 건수</div>
          <div className="metric__amount">{currentMonth ? cnt(currentMonth.count) : "-"}</div>
          <div className="metric__hint">{currentMonth ? `${currentMonth.month}월 (오늘까지)` : "데이터 없음"}</div>
        </section>
        <section className="metric">
          <div className="metric__label">총 결제금액</div>
          <div className="metric__amount">{won(amtTotal)}</div>
          <div className="metric__hint">{scope === "KOVAN" ? "카드·절삭 근사" : scope === "KICC" ? "KICC 수기" : scopeLabel}</div>
        </section>
        <section className="metric">
          <div className="metric__label">월 평균 금액</div>
          <div className="metric__amount">{won(amtAvg)}</div>
          <div className="metric__hint">{view.monthly.length}개월 평균</div>
        </section>
        <section className="metric">
          <div className="metric__label">이번달 금액</div>
          <div className="metric__amount">{won(thisMonthAmt)}</div>
          <div className="metric__hint">{currentMonth ? `${currentMonth.month}월 (오늘까지)` : "데이터 없음"}</div>
        </section>
      </div>

      <section className="card card--wide">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h2 className="card__title" style={{ margin: 0 }}>월별 거래 건수 — {scopeLabel}</h2>
          {scopeSelect}
        </div>
        <Chart monthly={view.monthly} />
      </section>

      {amtTotal > 0 && (
        <section className="card card--wide">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <h2 className="card__title" style={{ margin: 0 }}>
              월별 결제 금액 — {scopeLabel}
              {scope === "KOVAN" && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}> (카드 신용+체크·100만원 절삭 근사)</span>}
            </h2>
            {scopeSelect}
          </div>
          <AmtChart monthly={amtMonthly} />
        </section>
      )}

      {scope === "KICC" && (
        <div className="table-meta">※ KICC는 자동수집 대상이 아니며 구글시트 참고값(정적)입니다.</div>
      )}

      <TrTrend series={data.series} years={data.years} amudoMonths={data.amudoMonths} />

      <CmsSection />
    </div>
  );
}

function Chart({ monthly }: { monthly: TrMonth[] }) {
  const max = Math.max(1, ...monthly.map((m) => m.count));
  return (
    <div className="chart">
      {monthly.map((m, i) => {
        const isCurrent = i === monthly.length - 1;
        return (
          <div className="chart__col" key={m.month}>
            <div className="chart__bars" title={`${m.month}월`}>
              <div
                className="chart__bar chart__bar--cur"
                style={{ height: `${(m.count / max) * 100}%` }}
                title={`${m.month}월: ${cnt(m.count)}${isCurrent ? " (진행 중)" : ""}`}
              />
            </div>
            <div className="chart__xlabel">
              {m.month}월{isCurrent ? "*" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 월별 결제 금액 차트(선택 VAN) — 억/만 라벨
function AmtChart({ monthly }: { monthly: { month: number; amount: number }[] }) {
  const max = Math.max(1, ...monthly.map((m) => m.amount));
  const fmtA = (w: number) => (w >= 1e8 ? `${(w / 1e8).toFixed(1)}억` : w >= 1e4 ? `${Math.round(w / 1e4).toLocaleString()}만` : `${w}`);
  return (
    <div className="chart">
      {monthly.map((m, i) => {
        const isCurrent = i === monthly.length - 1;
        return (
          <div className="chart__col" key={m.month}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", marginBottom: 3, whiteSpace: "nowrap", lineHeight: 1 }}>
              {m.amount ? fmtA(m.amount) : ""}
            </div>
            <div className="chart__bars" title={`${m.month}월: ${m.amount.toLocaleString()}원`}>
              <div className="chart__bar chart__bar--cur" style={{ height: `${(m.amount / max) * 100}%`, background: "#f59e0b" }} />
            </div>
            <div className="chart__xlabel">
              {m.month}월{isCurrent ? "*" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 월별 결제 추이 — 년도 선택(1년치) · 건수(코밴+다우 스택) + 금액(코밴+다우) · 자동수집·누적
//   amountOnly=true 면 금액만(매출현황 메뉴에서 재사용, 건수는 거래현황 전용)
export function TrTrend({ series, years, amountOnly = false, amudoMonths }: { series?: TrSeries; years?: number[]; amountOnly?: boolean; amudoMonths?: Record<string, AmudoMonth> }) {
  const allYears = useMemo(() => {
    if (years && years.length) return [...new Set(years)].filter((y) => y >= 2025).sort((a, b) => a - b);
    if (series) return [...new Set(series.months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b);
    return [];
  }, [years, series]);
  const [selYear, setSelYear] = useState<number | null>(null);
  const year = selYear ?? (allYears.length ? allYears[allYears.length - 1] : null);
  const [trendScope, setTrendScope] = useState<"all" | "DAIN" | "AMUDO">("all"); // 다인/아무도없개 분리

  // 선택 연도에 아무도없개 데이터가 있으면 토글 노출
  const yearHasAmudo = useMemo(
    () => !!amudoMonths && Object.keys(amudoMonths).some((ym) => ym.startsWith(`${year}-`)),
    [amudoMonths, year]
  );
  const scoped = trendScope !== "all";

  if (!series || !series.months.length || !year) return null;

  // 막대 위 라벨용 축약: 건수=만, 금액=억
  const cntMan = (n: number) => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : n.toLocaleString());
  const eokShort = (w: number) => {
    const e = w / 1e8;
    return `${e >= 10 ? Math.round(e).toLocaleString() : Math.round(e * 10) / 10}억`;
  };
  const barCol = (h: number, bg: string, extra: CSSProperties = {}) => (
    <div style={{ height: `${h}%`, background: bg, ...extra }} />
  );
  const valLabel: CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--muted)", marginBottom: 3, whiteSpace: "nowrap", lineHeight: 1 };

  // KICC(정적·참고값): 연도별 월 배열. 자동수집 대상이 아니라 코밴/다우 series 에 없어 여기서 합침.
  const kiccOf = (yr: number) => (yr === YEAR ? kiccSeries.cur : yr === PREV_YEAR ? kiccSeries.prev : []);
  const kiccCur = kiccOf(year);
  const kiccAmtCur = KICC_AMOUNT[year] ?? []; // KICC 월별 결제금액(올해만 제공)

  // 선택 년도만 필터. 코밴 금액은 filled(실측+추정) 사용, kEst=추정 여부. total = 코밴+다우+KICC(건수)
  const amuOf = (m: number) => amudoMonths?.[`${year}-${String(m).padStart(2, "0")}`];
  const rows = series.months
    .map((ym, i) => {
      const m = Number(ym.slice(5, 7));
      let kovan = series.kovanCount[i];
      let ddwm = series.ddwmCount[i];
      let kicc = kiccCur[m - 1] ?? 0;
      let amt = series.ddwmAmount[i];
      let kAmt = series.kovanAmountFilled?.[i] ?? series.kovanAmount?.[i] ?? 0;
      let kAmtKicc = kiccAmtCur[m - 1] ?? 0;
      // 다인/아무도없개 분리 — 아무도없개는 코밴+다우만(KICC 없음), 다인은 합산−아무도없개
      if (scoped) {
        const a = amuOf(m);
        const aK = a?.kovan ?? { count: 0, amount: 0 };
        const aD = a?.ddwm ?? { count: 0, amount: 0 };
        if (trendScope === "AMUDO") {
          kovan = aK.count; ddwm = aD.count; kicc = 0;
          kAmt = aK.amount; amt = aD.amount; kAmtKicc = 0;
        } else {
          kovan = Math.max(0, kovan - aK.count); ddwm = Math.max(0, ddwm - aD.count);
          kAmt = Math.max(0, kAmt - aK.amount); amt = Math.max(0, amt - aD.amount);
        }
      }
      return {
        m, kovan, ddwm, kicc,
        total: kovan + ddwm + kicc,
        amt, kAmt, kAmtKicc,
        kEst: scoped ? false : (series.kovanAmountEst?.[i] ?? false),
      };
    })
    .filter((_, i) => series.months[i].startsWith(`${year}-`));
  const maxCnt = Math.max(1, ...rows.map((r) => r.total));
  const maxAmt = Math.max(1, ...rows.map((r) => r.amt + r.kAmt + r.kAmtKicc)); // 코밴+다우+KICC 스택 기준
  const yTotalCnt = rows.reduce((s, r) => s + r.total, 0);
  const yKovanCnt = rows.reduce((s, r) => s + r.kovan, 0);
  const yDdwmCnt = rows.reduce((s, r) => s + r.ddwm, 0);
  const yKiccCnt = rows.reduce((s, r) => s + r.kicc, 0);
  const yTotalAmt = rows.reduce((s, r) => s + r.amt, 0);
  const yKovanAmt = rows.reduce((s, r) => s + r.kAmt, 0);
  const yearHasEst = rows.some((r) => r.kEst);

  // 직전 년도 '동기간'(같은 월들) 합계 → 증감률
  const curMonthNums = rows.map((r) => r.m);
  const prevYear = year - 1;
  const kiccPrev = kiccOf(prevYear);
  const prevRows = series.months
    .map((ym, i) => ({ m: Number(ym.slice(5, 7)), total: series.totalCount[i] + (kiccPrev[Number(ym.slice(5, 7)) - 1] ?? 0), amt: series.ddwmAmount[i], ym }))
    .filter((x) => x.ym.startsWith(`${prevYear}-`) && curMonthNums.includes(x.m));
  const hasPrev = prevRows.length > 0;
  const prevCnt = prevRows.reduce((s, r) => s + r.total, 0);
  const prevAmt = prevRows.reduce((s, r) => s + r.amt, 0);
  const prevAvg = prevRows.length ? prevAmt / prevRows.length : 0;
  const gCnt = hasPrev && !scoped ? growth(yTotalCnt, prevCnt) : null;
  const gAmt = hasPrev && !scoped ? growth(yTotalAmt, prevAmt) : null;
  const gAvg = hasPrev && !scoped ? growth(rows.length ? yTotalAmt / rows.length : 0, prevAvg) : null;
  const compare = (g: ReturnType<typeof growth> | null, prevText: string, label = "동기간") =>
    g ? (
      <div className="metric__compare">
        <span className={`metric__badge metric__badge--${g.tone}`}>
          {g.tone === "up" ? "▲" : g.tone === "down" ? "▼" : ""} {g.text}
        </span>
        <span className="metric__compare-text">{prevYear} {label} {prevText}</span>
      </div>
    ) : null;

  // 코밴 YoY — 작년 동기간(같은 월) 비교. 작년 미수집 월은 filled(건수기반 추정치)로 채워 계산.
  //   다우 카드와 동일한 방식(현재 YTD vs 작년 동일 월). 추정치가 섞이면 배지에 '예측 포함' 표기.
  const prevKRows = series.months
    .map((ym, i) => ({ m: Number(ym.slice(5, 7)), kF: series.kovanAmountFilled?.[i] ?? series.kovanAmount?.[i] ?? 0, est: series.kovanAmountEst?.[i] ?? false, ym }))
    .filter((x) => x.ym.startsWith(`${prevYear}-`) && curMonthNums.includes(x.m));
  const prevKAmt = prevKRows.reduce((s, r) => s + r.kF, 0);
  const gKAmt = prevKAmt > 0 && !scoped ? growth(yKovanAmt, prevKAmt) : null;
  const gKAvg = prevKAmt > 0 && rows.length && prevKRows.length && !scoped ? growth(yKovanAmt / rows.length, prevKAmt / prevKRows.length) : null;
  const kEstInCompare = prevKRows.some((r) => r.est) || yearHasEst;

  return (
    <>
      <div className="ov__sec-h" style={{ marginTop: 8 }}>
        <h2>{amountOnly ? "VAN 결제금액" : "월별 결제 추이"}{trendScope === "AMUDO" ? " · 아무도없개" : trendScope === "DAIN" ? " · 다인" : ""}</h2>
        <span>{amountOnly ? "코밴·다우 가맹점 거래대금(참고) · 매일 08:00 자동수집" : "코밴·다우데이타 · 매일 08:00 자동수집·누적"}</span>
      </div>

      {/* 좌측 상단 년도 필터 + 다인/아무도없개 분리 */}
      <div className="van-tabs">
        {allYears.map((y) => (
          <button key={y} className={y === year ? "is-active" : ""} onClick={() => setSelYear(y)}>
            {y}년
          </button>
        ))}
        {yearHasAmudo && (
          <>
            <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "4px 2px" }} />
            <button className={trendScope === "all" ? "is-active" : ""} onClick={() => setTrendScope("all")}>전체</button>
            <button className={trendScope === "DAIN" ? "is-active" : ""} onClick={() => setTrendScope("DAIN")}>🏢 다인</button>
            <button className={trendScope === "AMUDO" ? "is-active" : ""} onClick={() => setTrendScope("AMUDO")}>🍦 아무도없개</button>
          </>
        )}
      </div>

      <div className="sales__kpis">
        {!amountOnly && (
          <section className="metric">
            <div className="metric__label">{year} 결제 건수</div>
            <div className="metric__amount">{cnt(yTotalCnt)}</div>
            {compare(gCnt, cnt(prevCnt))}
            <div className="metric__hint">코밴 {cnt(yKovanCnt)} · 다우 {cnt(yDdwmCnt)} · KICC {cnt(yKiccCnt)}</div>
          </section>
        )}
        <section className="metric">
          <div className="metric__label">{year} 결제 금액(다우)</div>
          <div className="metric__amount">{won(yTotalAmt)}</div>
          {compare(gAmt, won(prevAmt))}
          <div className="metric__hint">다우데이타 · {rows.length}개월</div>
        </section>
        <section className="metric">
          <div className="metric__label">월 평균 금액(다우)</div>
          <div className="metric__amount">{won(rows.length ? yTotalAmt / rows.length : 0)}</div>
          {compare(gAvg, won(prevAvg))}
          <div className="metric__hint">{year}년 {rows.length}개월 평균</div>
        </section>
        <section className="metric">
          <div className="metric__label">{year} 결제 금액(코밴)</div>
          <div className="metric__amount">{won(yKovanAmt)}</div>
          {gKAmt && compare(gKAmt, won(prevKAmt), `동기간${kEstInCompare ? "*" : ""}`)}
          <div className="metric__hint">
            카드 신용+체크 · 100만원 절삭 근사
            {kEstInCompare ? " · *미수집 월은 건수기반 예측" : ""}
          </div>
        </section>
        <section className="metric">
          <div className="metric__label">월 평균 금액(코밴)</div>
          <div className="metric__amount">{won(rows.length ? yKovanAmt / rows.length : 0)}</div>
          {gKAvg && compare(gKAvg, won(prevKRows.length ? prevKAmt / prevKRows.length : 0), `동기간${kEstInCompare ? "*" : ""}`)}
          <div className="metric__hint">
            {year}년 {rows.length}개월 평균{kEstInCompare ? " · *예측 포함" : ""}
          </div>
        </section>
      </div>

      {/* 건수 — 코밴 + 다우 스택 (매출현황에선 숨김) */}
      {!amountOnly && (
      <section className="card card--wide">
        <h2 className="card__title">{year}년 월별 결제 건수 — 코밴 + 다우데이타 + KICC</h2>
        <div className="chart">
          {rows.map((r) => (
            <div className="chart__col" key={r.m}>
              <div style={valLabel}>{cntMan(r.total)}</div>
              <div
                className="chart__bars"
                style={{ gap: 0 }}
                title={`${r.m}월: 합계 ${r.total.toLocaleString()}건 (코밴 ${r.kovan.toLocaleString()} · 다우 ${r.ddwm.toLocaleString()} · KICC ${r.kicc.toLocaleString()})`}
              >
                <div style={{ width: "58%", maxWidth: 28, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  {barCol((r.ddwm / maxCnt) * 100, "#4dd0c4", { borderRadius: "4px 4px 0 0" })}
                  {barCol((r.kovan / maxCnt) * 100, "#7c6df2")}
                  {barCol((r.kicc / maxCnt) * 100, "#f59e0b")}
                </div>
              </div>
              <div className="chart__xlabel">{r.m}월</div>
            </div>
          ))}
        </div>
        <div className="chart__legend">
          <span><i className="dot" style={{ background: "#7c6df2" }} /> 코밴</span>
          <span><i className="dot" style={{ background: "#4dd0c4" }} /> 다우데이타</span>
          <span><i className="dot" style={{ background: "#f59e0b" }} /> KICC(참고)</span>
        </div>
      </section>
      )}

      {/* 금액 — 코밴 + 다우 + KICC 스택 */}
      <section className="card card--wide">
        <h2 className="card__title">
          {year}년 월별 결제 금액 — 코밴 + 다우데이타 + KICC{" "}
          <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>(코밴은 카드 신용+체크·100만원 절삭 근사)</span>
        </h2>
        <div className="chart">
          {rows.map((r) => {
            const tot = r.amt + r.kAmt + r.kAmtKicc;
            return (
              <div className="chart__col" key={r.m}>
                <div style={valLabel}>{eokShort(tot)}</div>
                <div
                  className="chart__bars"
                  style={{ gap: 0 }}
                  title={`${r.m}월: 합계 ${tot.toLocaleString()}원 (코밴 ${r.kAmt.toLocaleString()}${r.kEst ? " 예측" : ""} · 다우 ${r.amt.toLocaleString()} · KICC ${r.kAmtKicc.toLocaleString()})`}
                >
                  <div style={{ width: "58%", maxWidth: 28, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    {barCol((r.amt / maxAmt) * 100, "#f59e0b", { borderRadius: "4px 4px 0 0" })}
                    {barCol((r.kAmt / maxAmt) * 100, "#7c6df2", r.kEst ? { opacity: 0.4 } : {})}
                    {barCol((r.kAmtKicc / maxAmt) * 100, "#22c55e")}
                  </div>
                </div>
                <div className="chart__xlabel">{r.m}월{r.kEst ? "˚" : ""}</div>
              </div>
            );
          })}
        </div>
        <div className="chart__legend">
          <span><i className="dot" style={{ background: "#7c6df2" }} /> 코밴(카드·근사)</span>
          <span><i className="dot" style={{ background: "#f59e0b" }} /> 다우데이타</span>
          <span><i className="dot" style={{ background: "#22c55e" }} /> KICC</span>
          {yearHasEst && <span style={{ color: "var(--muted)" }}>˚ 옅은 보라 = 건수기반 예측(미수집 월)</span>}
        </div>
      </section>
    </>
  );
}

// CMS 매출 (효성CMS 수납액 실데이터) — 거래현황·매출현황에서 재사용
export function CmsSection() {
  const [real, setReal] = useState<{ cur: number[]; prev: number[] } | null>(null);
  useEffect(() => {
    fetchCms()
      .then((d) => { if (d.cur || d.prev) setReal({ cur: d.cur ?? cmsSeries.cur, prev: d.prev ?? cmsSeries.prev }); })
      .catch(() => {});
  }, []);
  const cur = real?.cur ?? cmsSeries.cur;
  const prev = real?.prev ?? cmsSeries.prev;
  const n = cur.length;
  const ytdCur = sumArr(cur);
  const ytdPrev = sumArr(prev.slice(0, n));
  const g = growth(ytdCur, ytdPrev);
  const thisMonth = cur[n - 1] ?? 0;
  const prevThisMonth = prev[n - 1] ?? 0;
  // 월 평균·이번달 작년 대비
  const gAvg = growth(n ? ytdCur / n : 0, n ? ytdPrev / n : 0);
  const gThis = growth(thisMonth, prevThisMonth);
  // 역대 최저·최고 (진행 중인 이번달 제외 — 부분값이 최저로 잡히는 착시 방지)
  const hist: { v: number; label: string }[] = [];
  cur.forEach((v, i) => { if (v > 0 && i < n - 1) hist.push({ v, label: `올해 ${i + 1}월` }); });
  prev.forEach((v, i) => { if (v > 0) hist.push({ v, label: `작년 ${i + 1}월` }); });
  const hi = hist.length ? hist.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const lo = hist.length ? hist.reduce((a, b) => (b.v < a.v ? b : a)) : null;

  return (
    <>
      <div className="ov__sec-h" style={{ marginTop: 8 }}>
        <h2>CMS 매출</h2>
        <span>월별 · 작년 대비 (효성CMS 수납액)</span>
      </div>

      <div className="sales__kpis">
        <section className="metric">
          <div className="metric__label">CMS 누적 매출</div>
          <div className="metric__amount">{won(ytdCur)}</div>
          <div className="metric__compare">
            <span className={`metric__badge metric__badge--${g.tone}`}>
              {g.tone === "up" ? "▲" : g.tone === "down" ? "▼" : ""} {g.text}
            </span>
            <span className="metric__compare-text">작년 동기 {won(ytdPrev)}</span>
          </div>
          <div className="metric__hint">올해 1~{n}월 누적</div>
        </section>
        <section className="metric">
          <div className="metric__label">월 평균 CMS</div>
          <div className="metric__amount">{won(n ? ytdCur / n : 0)}</div>
          <div className="metric__compare">
            <span className={`metric__badge metric__badge--${gAvg.tone}`}>
              {gAvg.tone === "up" ? "▲" : gAvg.tone === "down" ? "▼" : ""} {gAvg.text}
            </span>
            <span className="metric__compare-text">작년 동기 {won(n ? ytdPrev / n : 0)}</span>
          </div>
          <div className="metric__hint">{n}개월 평균</div>
        </section>
        <section className="metric">
          <div className="metric__label">이번달 CMS</div>
          <div className="metric__amount">{won(thisMonth)}</div>
          <div className="metric__compare">
            <span className={`metric__badge metric__badge--${gThis.tone}`}>
              {gThis.tone === "up" ? "▲" : gThis.tone === "down" ? "▼" : ""} {gThis.text}
            </span>
            <span className="metric__compare-text">작년 {n}월 {won(prevThisMonth)}</span>
          </div>
          <div className="metric__hint">{n}월 (진행 중)</div>
        </section>
        {hi && (
          <section className="metric">
            <div className="metric__label">역대 최고 CMS</div>
            <div className="metric__amount">{won(hi.v)}</div>
            <div className="metric__hint">{hi.label}</div>
          </section>
        )}
        {lo && (
          <section className="metric">
            <div className="metric__label">역대 최저 CMS</div>
            <div className="metric__amount">{won(lo.v)}</div>
            <div className="metric__hint">{lo.label} · 진행 중인 달 제외</div>
          </section>
        )}
      </div>

      <section className="card card--wide">
        <h2 className="card__title">월별 CMS 매출 — 올해 vs 작년</h2>
        <MonthBars cur={cur} prev={prev} unit="won" labelCur="올해" labelPrev="작년" />
      </section>
    </>
  );
}
