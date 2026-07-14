import { useEffect, useState } from "react";
import { won } from "../lib/format";
import { fetchSalesMonthly, type SalesMonthly } from "../lib/sales";
import { fetchCms, type CmsData } from "../lib/cms";
import { fetchTr, type TrData } from "../lib/tr";
import { fetchTerminals, type TerminalUsage } from "../lib/terminals";
import {
  YEAR,
  PREV_YEAR,
  fmtCount,
  forecast,
  monthlyYoY,
  scorecard,
  type Mseries,
  type Unit,
  type Scorecard,
  totalSales,
  cms as cmsFallback,
  SALES_CATS,
  sumCats,
} from "../lib/overview";

function fmt(n: number, unit: Unit): string {
  return unit === "won" ? won(n) : fmtCount(n, unit);
}

// 작년을 넘기 위한 한 줄 처방
function onePoint(s: Mseries): string {
  const sc = scorecard(s);
  const u = (n: number) => fmt(n, s.unit);
  if (sc.yearEndScore == null) return "작년 데이터가 없어 목표 설정이 필요합니다.";
  if (sc.onTrack) return `현 추세면 작년(100점)을 넘어설 전망 — 지금 페이스를 유지하세요.`;
  let t = `작년(100점)을 넘으려면 남은 ${sc.remaining}개월간 월 평균 ${u(sc.neededPerMonth)} 이상 필요`;
  if (sc.upliftPct != null)
    t += ` (현재 월평균 ${u(sc.recentAvg)} 대비 ${sc.upliftPct >= 0 ? "+" : ""}${sc.upliftPct.toFixed(0)}%).`;
  else t += ".";
  return t;
}
const pctTxt = (p: number | null) => (p == null ? "비교 불가" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`);
const toneOf = (p: number | null) => (p == null ? "muted" : p > 0.5 ? "up" : p < -0.5 ? "down" : "flat");

// VAN 결제금액 시리즈(코밴 filled + 다우) — 올해 vs 작년, /api/tr 라이브
export function vanAmtSeries(tr: TrData): Mseries {
  const s = tr.series;
  const byYear = (yr: number) => {
    const arr = Array(12).fill(0);
    s?.months.forEach((m, i) => {
      if (m.startsWith(`${yr}-`)) {
        const mi = Number(m.slice(5, 7)) - 1;
        arr[mi] = (s.kovanAmountFilled?.[i] ?? s.kovanAmount?.[i] ?? 0) + (s.ddwmAmount?.[i] ?? 0);
      }
    });
    return arr;
  };
  const curFull = byYear(YEAR);
  let last = 0;
  curFull.forEach((v, i) => { if (v > 0) last = i + 1; });
  return { key: "vanamt", label: "VAN 결제금액", unit: "won", cur: curFull.slice(0, last), prev: byYear(PREV_YEAR) };
}

export function ManagementMetrics() {
  const [sales, setSales] = useState<SalesMonthly | null>(null);
  const [cmsData, setCmsData] = useState<CmsData | null>(null);
  const [tr, setTr] = useState<TrData | null>(null);
  const [term, setTerm] = useState<TerminalUsage | null>(null);

  useEffect(() => {
    fetchSalesMonthly().then(setSales).catch(() => {});
    fetchCms().then(setCmsData).catch(() => {});
    fetchTr().then(setTr).catch(() => {});
    fetchTerminals().then(setTerm).catch(() => {});
  }, []);

  if (!sales || !cmsData || !tr) {
    return <div className="state">경영지표 데이터를 불러오는 중…</div>;
  }

  // ===== 라이브 실데이터로 핵심 재무지표 3종 구성 =====
  const totalCur = sales.lastMonth > 0 ? sumCats(sales.curByCat, SALES_CATS, sales.lastMonth) : totalSales.cur;
  const totalM: Mseries = { key: "total", label: "총매출", unit: "won", cur: totalCur, prev: totalSales.prev };
  const cmsM: Mseries = {
    key: "cms",
    label: "CMS 수납",
    unit: "won",
    cur: cmsData.cur ?? cmsFallback.cur,
    prev: cmsData.prev ?? cmsFallback.prev,
  };
  const vanM = vanAmtSeries(tr);

  const METRICS: { s: Mseries; icon: string }[] = [
    { s: totalM, icon: "💰" },
    { s: cmsM, icon: "💳" },
    { s: vanM, icon: "🔁" },
  ];
  const months = totalM.cur.length;

  return (
    <div className="mg">
      <div className="ov__banner">
        경영지표 — {YEAR}년 {months}월까지 누적 실적 · 작년({PREV_YEAR}) 동기 대비 평가 · 현재 추세 기반 연말 예상
        <span>· 총매출·CMS·VAN 결제금액은 실데이터(라이브). VAN 결제금액의 작년 코밴 일부는 건수기반 예측치</span>
      </div>

      {/* 0) 성과 점수 */}
      <Scoreboard metrics={METRICS} />

      {/* 1) 핵심 요약 */}
      <section className="ov__sec">
        <SecHead title="핵심 재무 요약" note={`${YEAR} 누적(YTD) · 작년 동기 대비 · 연말 예상`} />
        <div className="ov__row">
          {METRICS.map(({ s, icon }) => (
            <SummaryCard key={s.key} s={s} icon={icon} />
          ))}
        </div>
      </section>

      {/* 2) 사업 건전성 (현재 상태) */}
      <HealthSnapshot term={term} />

      {/* 3) 연말 전망 */}
      <section className="ov__sec">
        <SecHead title="올해 연말 전망" note="작년 계절성 반영 추정 · 작년 실적과 비교" />
        <div className="ov__row">
          {METRICS.map(({ s }) => (
            <ForecastCard key={s.key} s={s} />
          ))}
        </div>
      </section>

      {/* 4) 지표별 상세 — 추이 + 월별 동월대비 + 인사이트 */}
      <section className="ov__sec">
        <SecHead title="지표별 추이 · 월별 동월 대비" note="올해 vs 작년" />
        {METRICS.map(({ s, icon }) => (
          <MetricBlock key={s.key} s={s} icon={icon} />
        ))}
      </section>
    </div>
  );
}

// ===== 성과 점수판 (작년=100점) =====
export function Scoreboard({ metrics }: { metrics: { s: Mseries; icon: string }[] }) {
  const cards = metrics.map(({ s, icon }) => ({ s, icon, sc: scorecard(s) }));
  const scored = cards.filter((c) => c.sc.ytdScore != null);
  const overall = scored.length
    ? Math.round(scored.reduce((a, c) => a + (c.sc.ytdScore as number), 0) / scored.length)
    : null;
  const overallBand = overall == null ? "na" : overall >= 100 ? "good" : overall >= 85 ? "warn" : "bad";

  // 원포인트 집중 지표: 연말 예상이 작년에 가장 못 미치는 지표
  const focus = cards
    .filter((c) => c.sc.yearEndScore != null && !c.sc.onTrack)
    .sort((a, b) => (a.sc.yearEndScore as number) - (b.sc.yearEndScore as number))[0];

  return (
    <section className="ov__sec">
      <SecHead title="성과 점수" note={`작년(${PREV_YEAR}) 동기 = 100점 기준`} />

      <div className="score-top">
        <div className={`score-hero score-hero--${overallBand}`}>
          <div className="score-hero__cap">종합 점수</div>
          <div className="score-hero__num">
            {overall ?? "-"}
            <span>점</span>
          </div>
          <div className="score-hero__sub">작년 동기 = 100점</div>
        </div>

        <div className="score-grid">
          {cards.map(({ s, icon, sc }) => (
            <div className="score-card" key={s.key}>
              <div className="score-card__head">
                <span className="score-card__name">
                  {icon} {s.label}
                </span>
                <span className={`score-card__grade score-card__grade--${sc.band}`}>{sc.grade}</span>
              </div>
              <div className="score-card__num">
                {sc.ytdScore == null ? "-" : Math.round(sc.ytdScore)}
                <span>점</span>
              </div>
              <ScoreBar score={sc.ytdScore} band={sc.band} />
              <div className="score-card__yend">
                연말 예상 <b>{sc.yearEndScore == null ? "-" : Math.round(sc.yearEndScore)}점</b>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mg-onepoint mg-onepoint--lead">
        <span className="mg-onepoint__tag">💡 원포인트</span>
        {focus ? (
          <span>
            <b>{focus.s.label}</b> 이 작년 대비 가장 뒤처져 있습니다 (연말 예상{" "}
            {Math.round(focus.sc.yearEndScore as number)}점). {onePoint(focus.s)}
          </span>
        ) : (
          <span>모든 핵심 지표가 작년 수준 이상으로 순항 중입니다 — 현 페이스를 유지하세요.</span>
        )}
      </div>
    </section>
  );
}

// ===== 사업 건전성 (현재 상태 · 단말기/가맹점 라이브) =====
function HealthSnapshot({ term }: { term: TerminalUsage | null }) {
  const m = term?.merchants?.combined;
  const k = term?.kovan, d = term?.ddwm;
  const okK = k && !k.error, okD = d && !d.error;
  const opened = (okK ? k!.opened : 0) + (okD ? d!.opened : 0);
  const used = (okK ? k!.used : 0) + (okD ? d!.used : 0);
  const idle = (okK ? k!.idle : 0) + (okD ? d!.idle : 0);
  const useRate = opened ? Math.round((used / opened) * 100) : null;
  const idleRate = opened ? Math.round((idle / opened) * 100) : null;

  return (
    <section className="ov__sec">
      <SecHead title="사업 건전성 (현재)" note="운영 가맹점 · 단말기 가동률 · 미사용률 — 코밴+다우 실데이터" />
      <div className="ov__row">
        <section className="metric">
          <div className="metric__label">🏪 운영 가맹점</div>
          <div className="metric__amount">{m ? `${m.used.toLocaleString("ko-KR")}곳` : "-"}</div>
          <div className="metric__hint">{m ? `개통 ${m.opened.toLocaleString("ko-KR")} · 미사용 ${m.idle}` : "수집 전"}</div>
        </section>
        <section className="metric">
          <div className="metric__label">⚙️ 단말기 가동률</div>
          <div className="metric__amount">{useRate == null ? "-" : `${useRate}%`}</div>
          <div className="metric__hint">{opened ? `사용 ${used.toLocaleString("ko-KR")} / 개통 ${opened.toLocaleString("ko-KR")}` : "수집 전"}</div>
        </section>
        <section className="metric">
          <div className="metric__label">💤 미사용률</div>
          <div className="metric__amount" style={idleRate != null && idleRate > 20 ? { color: "#dc2626" } : undefined}>
            {idleRate == null ? "-" : `${idleRate}%`}
          </div>
          <div className="metric__hint">{opened ? `미사용 ${idle.toLocaleString("ko-KR")}대 (7일 미결제)` : "수집 전"}</div>
        </section>
      </div>
    </section>
  );
}

function ScoreBar({ score, band }: { score: number | null; band: string }) {
  const SCALE = 150; // 0~150점 시각화 (100 기준선)
  const w = (Math.min(Math.max(score ?? 0, 0), SCALE) / SCALE) * 100;
  return (
    <div className="score-bar">
      <div className={`score-bar__fill score-bar__fill--${band}`} style={{ width: `${w}%` }} />
      <div className="score-bar__base" title="작년 100점" />
    </div>
  );
}

function SecHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="ov__sec-h">
      <h2>{title}</h2>
      {note && <span>{note}</span>}
    </div>
  );
}

function SummaryCard({ s, icon }: { s: Mseries; icon: string }) {
  const f = forecast(s);
  const yoy = f.ytdPrev > 0 ? ((f.ytdCur - f.ytdPrev) / f.ytdPrev) * 100 : null;
  return (
    <section className="metric">
      <div className="metric__label">
        <span style={{ marginRight: 6 }}>{icon}</span>
        {s.label}
      </div>
      <div className="metric__amount">{fmt(f.ytdCur, s.unit)}</div>
      <div className="metric__compare">
        <span className={`metric__badge metric__badge--${toneOf(yoy)}`}>
          {yoy != null && (yoy > 0 ? "▲" : yoy < 0 ? "▼" : "")} {pctTxt(yoy)}
        </span>
        <span className="metric__compare-text">작년 동기 {fmt(f.ytdPrev, s.unit)}</span>
      </div>
      <div className="metric__hint">
        연말 예상 <b>{fmt(f.forecast, s.unit)}</b>
      </div>
    </section>
  );
}

function ForecastCard({ s }: { s: Mseries }) {
  const f = forecast(s);
  const max = Math.max(1, f.forecast, f.prevFull);
  return (
    <section className="mg-fc">
      <div className="mg-fc__label">{s.label}</div>
      <div className="mg-fc__bars">
        <Bar label={`${PREV_YEAR} 실적`} value={f.prevFull} max={max} unit={s.unit} cls="prev" />
        <Bar label={`${YEAR} 예상`} value={f.forecast} max={max} unit={s.unit} cls="cur" />
      </div>
      <div className="mg-fc__delta">
        <span className={`metric__badge metric__badge--${toneOf(f.vsPrevFull)}`}>
          {f.vsPrevFull != null && (f.vsPrevFull > 0 ? "▲" : f.vsPrevFull < 0 ? "▼" : "")} {pctTxt(f.vsPrevFull)}
        </span>
        <span className="mg-fc__note">작년 연간 대비</span>
      </div>
    </section>
  );
}

function Bar({ label, value, max, unit, cls }: { label: string; value: number; max: number; unit: Unit; cls: "cur" | "prev" }) {
  return (
    <div className="mg-bar">
      <div className="mg-bar__track">
        <div className={`mg-bar__fill mg-bar__fill--${cls}`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <div className="mg-bar__row">
        <span className="mg-bar__name">{label}</span>
        <span className="mg-bar__val">{fmt(value, unit)}</span>
      </div>
    </div>
  );
}

function MetricBlock({ s, icon }: { s: Mseries; icon: string }) {
  const f = forecast(s);
  const rows = monthlyYoY(s);
  const yoy = f.ytdPrev > 0 ? ((f.ytdCur - f.ytdPrev) / f.ytdPrev) * 100 : null;
  const max = Math.max(1, ...s.cur, ...s.prev);
  const sc: Scorecard = scorecard(s);

  return (
    <section className="card card--wide mg-block">
      <div className="mg-block__head">
        <h3 className="card__title">
          {icon} {s.label}
        </h3>
        <div className="mg-block__badges">
          <span className={`score-card__grade score-card__grade--${sc.band}`}>
            {sc.ytdScore == null ? "-" : Math.round(sc.ytdScore)}점 · {sc.grade}
          </span>
          <span className={`metric__badge metric__badge--${toneOf(yoy)}`}>YTD {pctTxt(yoy)}</span>
        </div>
      </div>

      <div className="mg-block__grid">
        {/* 추이 차트 */}
        <div className="chart">
          {Array.from({ length: 12 }, (_, i) => {
            const c = s.cur[i] ?? 0;
            const p = s.prev[i] ?? 0;
            const isLast = i === s.cur.length - 1;
            return (
              <div className="chart__col" key={i}>
                <div className="chart__bars" title={`${i + 1}월`}>
                  <div className="chart__bar chart__bar--prev" style={{ height: `${(p / max) * 100}%` }} title={`작년 ${i + 1}월: ${fmt(p, s.unit)}`} />
                  <div className="chart__bar chart__bar--cur" style={{ height: `${(c / max) * 100}%` }} title={`올해 ${i + 1}월: ${fmt(c, s.unit)}`} />
                </div>
                <div className="chart__xlabel">
                  {i + 1}
                  {isLast ? "*" : ""}
                </div>
              </div>
            );
          })}
        </div>

        {/* 월별 동월 대비 표 */}
        <div className="mg-table-wrap">
          <table className="mg-table">
            <thead>
              <tr>
                <th>월</th>
                <th>올해</th>
                <th>작년</th>
                <th>증감</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}월</td>
                  <td>{fmt(r.cur, s.unit)}</td>
                  <td className="muted">{fmt(r.prev, s.unit)}</td>
                  <td className={`mg-yoy mg-yoy--${r.tone}`}>{pctTxt(r.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mg-insight">{insight(s)}</p>
      <div className="mg-onepoint">
        <span className="mg-onepoint__tag">🎯 원포인트</span>
        <span>{onePoint(s)}</span>
      </div>
    </section>
  );
}

// 자동 인사이트 문장
function insight(s: Mseries): string {
  const f = forecast(s);
  const u = (n: number) => fmt(n, s.unit);
  const yoy = f.ytdPrev > 0 ? ((f.ytdCur - f.ytdPrev) / f.ytdPrev) * 100 : null;
  const rows = monthlyYoY(s).filter((m) => m.pct != null);

  let t = `올해 ${f.months}개월 누적 ${u(f.ytdCur)}, 작년 동기 ${u(f.ytdPrev)}`;
  if (yoy != null) t += ` (${pctTxt(yoy)})`;
  t += ". ";

  if (rows.length) {
    const best = rows.reduce((a, b) => (b.pct! > a.pct! ? b : a));
    const worst = rows.reduce((a, b) => (b.pct! < a.pct! ? b : a));
    t += `가장 좋은 달은 ${best.month}월(${pctTxt(best.pct)}), 부진한 달은 ${worst.month}월(${pctTxt(worst.pct)}). `;
  }
  t += `현 추세 기준 연말 예상 ${u(f.forecast)}`;
  if (f.vsPrevFull != null) t += ` — 작년 연간 ${u(f.prevFull)} 대비 ${pctTxt(f.vsPrevFull)}`;
  t += ".";
  return t;
}
