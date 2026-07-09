import { useMemo, useState, useEffect, type CSSProperties } from "react";
import { fetchTr, syncTr, type TrData, type TrMonth, type TrVan, type TrSeries } from "../lib/tr";
import { kicc as kiccSeries, cms as cmsSeries } from "../lib/overview";
import { fetchCms } from "../lib/cms";
import { won, growth } from "../lib/format";

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
  const [scope, setScope] = useState("all"); // "all" | van

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
    const v = aug.vans.find((x) => x.van === scope);
    return v
      ? { monthly: v.monthly, total: v.total, avg: v.avg }
      : { monthly: [], total: 0, avg: 0 };
  }, [aug, scope]);

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
      </div>

      <div className="sales__kpis">
        <section className="metric">
          <div className="metric__label">총합 건수</div>
          <div className="metric__amount">{cnt(view.total)}</div>
          <div className="metric__hint">
            {data.year}년 1월~{currentMonth ? `${currentMonth.month}월` : "현재"} ·{" "}
            {scope === "all" ? "코밴+다우데이타+KICC" : scope}
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
      </div>

      <section className="card card--wide">
        <h2 className="card__title">
          월별 거래 건수 —{" "}
          {scope === "all" ? "합산(코밴+다우데이타+KICC)" : aug.vans.find((v) => v.van === scope)?.label}
        </h2>
        <Chart monthly={view.monthly} />
      </section>

      {scope === "KICC" && (
        <div className="table-meta">※ KICC는 자동수집 대상이 아니며 구글시트 참고값(정적)입니다.</div>
      )}

      <TrTrend series={data.series} years={data.years} />

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

// 월별 결제 추이 — 년도 선택(1년치) · 건수(코밴+다우 스택) + 금액(다우) · 자동수집·누적
function TrTrend({ series, years }: { series?: TrSeries; years?: number[] }) {
  const allYears = useMemo(() => {
    if (years && years.length) return [...new Set(years)].filter((y) => y >= 2025).sort((a, b) => a - b);
    if (series) return [...new Set(series.months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b);
    return [];
  }, [years, series]);
  const [selYear, setSelYear] = useState<number | null>(null);
  const year = selYear ?? (allYears.length ? allYears[allYears.length - 1] : null);

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

  // 선택 년도만 필터
  const rows = series.months
    .map((ym, i) => ({ m: Number(ym.slice(5, 7)), kovan: series.kovanCount[i], ddwm: series.ddwmCount[i], total: series.totalCount[i], amt: series.ddwmAmount[i], kAmt: series.kovanAmount?.[i] ?? 0 }))
    .filter((_, i) => series.months[i].startsWith(`${year}-`));
  const maxCnt = Math.max(1, ...rows.map((r) => r.total));
  const maxAmt = Math.max(1, ...rows.map((r) => r.amt + r.kAmt)); // 코밴+다우 스택 기준
  const yTotalCnt = rows.reduce((s, r) => s + r.total, 0);
  const yKovanCnt = rows.reduce((s, r) => s + r.kovan, 0);
  const yDdwmCnt = rows.reduce((s, r) => s + r.ddwm, 0);
  const yTotalAmt = rows.reduce((s, r) => s + r.amt, 0);
  const yKovanAmt = rows.reduce((s, r) => s + r.kAmt, 0);

  // 직전 년도 '동기간'(같은 월들) 합계 → 증감률
  const curMonthNums = rows.map((r) => r.m);
  const prevYear = year - 1;
  const prevRows = series.months
    .map((ym, i) => ({ m: Number(ym.slice(5, 7)), total: series.totalCount[i], amt: series.ddwmAmount[i], ym }))
    .filter((x) => x.ym.startsWith(`${prevYear}-`) && curMonthNums.includes(x.m));
  const hasPrev = prevRows.length > 0;
  const prevCnt = prevRows.reduce((s, r) => s + r.total, 0);
  const prevAmt = prevRows.reduce((s, r) => s + r.amt, 0);
  const prevAvg = prevRows.length ? prevAmt / prevRows.length : 0;
  const gCnt = hasPrev ? growth(yTotalCnt, prevCnt) : null;
  const gAmt = hasPrev ? growth(yTotalAmt, prevAmt) : null;
  const gAvg = hasPrev ? growth(rows.length ? yTotalAmt / rows.length : 0, prevAvg) : null;
  const compare = (g: ReturnType<typeof growth> | null, prevText: string) =>
    g ? (
      <div className="metric__compare">
        <span className={`metric__badge metric__badge--${g.tone}`}>
          {g.tone === "up" ? "▲" : g.tone === "down" ? "▼" : ""} {g.text}
        </span>
        <span className="metric__compare-text">{prevYear} 동기간 {prevText}</span>
      </div>
    ) : null;

  return (
    <>
      <div className="ov__sec-h" style={{ marginTop: 8 }}>
        <h2>월별 결제 추이</h2>
        <span>코밴·다우데이타 · 매일 08:00 자동수집·누적</span>
      </div>

      {/* 좌측 상단 년도 필터 */}
      <div className="van-tabs">
        {allYears.map((y) => (
          <button key={y} className={y === year ? "is-active" : ""} onClick={() => setSelYear(y)}>
            {y}년
          </button>
        ))}
      </div>

      <div className="sales__kpis">
        <section className="metric">
          <div className="metric__label">{year} 결제 건수</div>
          <div className="metric__amount">{cnt(yTotalCnt)}</div>
          {compare(gCnt, cnt(prevCnt))}
          <div className="metric__hint">코밴 {cnt(yKovanCnt)} · 다우 {cnt(yDdwmCnt)}</div>
        </section>
        <section className="metric">
          <div className="metric__label">{year} 결제 금액(다우)</div>
          <div className="metric__amount">{won(yTotalAmt)}</div>
          {compare(gAmt, won(prevAmt))}
          <div className="metric__hint">다우데이타 · {rows.length}개월</div>
        </section>
        <section className="metric">
          <div className="metric__label">{year} 결제 금액(코밴)</div>
          <div className="metric__amount">{won(yKovanAmt)}</div>
          <div className="metric__hint">
            카드 신용+체크 · 100만원 절삭 근사{yKovanAmt ? "" : " · 최근 1년만 제공"}
          </div>
        </section>
        <section className="metric">
          <div className="metric__label">월 평균 금액(다우)</div>
          <div className="metric__amount">{won(rows.length ? yTotalAmt / rows.length : 0)}</div>
          {compare(gAvg, won(prevAvg))}
          <div className="metric__hint">{year}년 {rows.length}개월 평균</div>
        </section>
      </div>

      {/* 건수 — 코밴 + 다우 스택 */}
      <section className="card card--wide">
        <h2 className="card__title">{year}년 월별 결제 건수 — 코밴 + 다우데이타</h2>
        <div className="chart">
          {rows.map((r) => (
            <div className="chart__col" key={r.m}>
              <div style={valLabel}>{cntMan(r.total)}</div>
              <div
                className="chart__bars"
                style={{ gap: 0 }}
                title={`${r.m}월: 합계 ${r.total.toLocaleString()}건 (코밴 ${r.kovan.toLocaleString()} · 다우 ${r.ddwm.toLocaleString()})`}
              >
                <div style={{ width: "58%", maxWidth: 28, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  {barCol((r.ddwm / maxCnt) * 100, "#4dd0c4", { borderRadius: "4px 4px 0 0" })}
                  {barCol((r.kovan / maxCnt) * 100, "#7c6df2")}
                </div>
              </div>
              <div className="chart__xlabel">{r.m}월</div>
            </div>
          ))}
        </div>
        <div className="chart__legend">
          <span><i className="dot" style={{ background: "#7c6df2" }} /> 코밴</span>
          <span><i className="dot" style={{ background: "#4dd0c4" }} /> 다우데이타</span>
        </div>
      </section>

      {/* 금액 — 코밴 + 다우 스택 */}
      <section className="card card--wide">
        <h2 className="card__title">
          {year}년 월별 결제 금액 — 코밴 + 다우데이타{" "}
          <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>(코밴은 카드 신용+체크·100만원 절삭 근사)</span>
        </h2>
        <div className="chart">
          {rows.map((r) => {
            const tot = r.amt + r.kAmt;
            return (
              <div className="chart__col" key={r.m}>
                <div style={valLabel}>{eokShort(tot)}</div>
                <div
                  className="chart__bars"
                  style={{ gap: 0 }}
                  title={`${r.m}월: 합계 ${tot.toLocaleString()}원 (코밴 ${r.kAmt.toLocaleString()} · 다우 ${r.amt.toLocaleString()})`}
                >
                  <div style={{ width: "58%", maxWidth: 28, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    {barCol((r.amt / maxAmt) * 100, "#f59e0b", { borderRadius: "4px 4px 0 0" })}
                    {barCol((r.kAmt / maxAmt) * 100, "#7c6df2")}
                  </div>
                </div>
                <div className="chart__xlabel">{r.m}월</div>
              </div>
            );
          })}
        </div>
        <div className="chart__legend">
          <span><i className="dot" style={{ background: "#7c6df2" }} /> 코밴(카드·근사)</span>
          <span><i className="dot" style={{ background: "#f59e0b" }} /> 다우데이타</span>
        </div>
      </section>
    </>
  );
}

// CMS 매출 (효성CMS 수납액 실데이터) — 거래현황 내 별도 섹션
function CmsSection() {
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
  const max = Math.max(1, ...cur, ...prev);

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
          <div className="metric__hint">{n}개월 평균</div>
        </section>
        <section className="metric">
          <div className="metric__label">이번달 CMS</div>
          <div className="metric__amount">{won(thisMonth)}</div>
          <div className="metric__hint">{n}월 (진행 중)</div>
        </section>
      </div>

      <section className="card card--wide">
        <h2 className="card__title">월별 CMS 매출 — 올해 vs 작년</h2>
        <div className="chart">
          {Array.from({ length: 12 }, (_, i) => {
            const c = cur[i] ?? 0;
            const p = prev[i] ?? 0;
            const isLast = i === n - 1;
            return (
              <div className="chart__col" key={i}>
                <div className="chart__bars" title={`${i + 1}월`}>
                  <div
                    className="chart__bar chart__bar--prev"
                    style={{ height: `${(p / max) * 100}%` }}
                    title={`작년 ${i + 1}월: ${won(p)}`}
                  />
                  <div
                    className="chart__bar chart__bar--cur"
                    style={{ height: `${(c / max) * 100}%` }}
                    title={`올해 ${i + 1}월: ${won(c)}`}
                  />
                </div>
                <div className="chart__xlabel">
                  {i + 1}
                  {isLast ? "*" : ""}
                </div>
              </div>
            );
          })}
        </div>
        <div className="chart__legend">
          <span><i className="dot dot--cur" /> 올해</span>
          <span><i className="dot dot--prev" /> 작년</span>
        </div>
      </section>
    </>
  );
}
