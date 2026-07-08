import { useEffect, useState } from "react";
import { won, growth } from "../lib/format";
import { YoutubeCard } from "./YoutubeCard";
import { fetchYoutube, type YoutubeStats } from "../lib/youtube";
import { fetchCms } from "../lib/cms";
import { fetchSalesMonthly, type SalesMonthly } from "../lib/sales";
import {
  YEAR,
  PREV_YEAR,
  ytd,
  fmtCount,
  type Mseries,
  type Unit,
  totalSales,
  SALES_2025,
  SALES_CATS,
  sumCats,
  cms,
  van,
  daou,
  kovan,
  kicc,
} from "../lib/overview";

// 단위 인지 포매터
function fmt(n: number, unit: Unit): string {
  return unit === "won" ? won(n) : fmtCount(n, unit);
}

// ===== KPI 카드 (YTD + 작년 동기간 대비) =====
function Kpi({
  icon,
  series,
  hint,
  override,
  noCompare,
}: {
  icon: string;
  series: Mseries;
  hint?: string;
  override?: { cur: number; prev: number; value: string };
  noCompare?: boolean;
}) {
  const y = ytd(series);
  const cur = override ? override.cur : y.cur;
  const prev = override ? override.prev : y.prev;
  const g = growth(cur, prev);
  const value = override ? override.value : fmt(cur, series.unit);

  return (
    <section className="metric">
      <div className="metric__label">
        <span style={{ marginRight: 6 }} aria-hidden>
          {icon}
        </span>
        {series.label}
        {series.sample && <span className="ov__sample-tag">샘플</span>}
      </div>
      <div className="metric__amount">{value}</div>
      {!noCompare && (
        <div className="metric__compare">
          <span className={`metric__badge metric__badge--${g.tone}`}>
            {g.tone === "up" ? "▲" : g.tone === "down" ? "▼" : ""} {g.text}
          </span>
          <span className="metric__compare-text">
            작년 동기간 {fmt(prev, series.unit)}
          </span>
        </div>
      )}
      <div className="metric__hint">
        {hint ?? `${YEAR}년 1~${y.months}월 누적 · 작년 동기 대비`}
      </div>
    </section>
  );
}

// 축 눈금: 데이터 최대값 → 4구간 라운드 스케일(간격·최대)
function niceScale(dataMax: number, ticks = 4): { max: number; step: number } {
  const rough = Math.max(1, dataMax) / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const unitStep = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 5 ? 5 : 10;
  const step = unitStep * pow;
  return { max: step * ticks, step };
}
// 축 라벨(간결): 원→만/억, 건→만
function axisLabel(v: number, unit: Unit): string {
  if (v === 0) return "0";
  if (unit === "won") {
    if (v >= 1e8) return (v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1) + "억";
    return Math.round(v / 1e4).toLocaleString("ko-KR") + "만";
  }
  if (v >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만";
  return Math.round(v).toLocaleString("ko-KR");
}

// ===== 월별 막대 (올해 vs 작년) — 좌측 금액 눈금 + 가로 격자선 =====
function MonthBars({
  cur,
  prev,
  unit,
  colorCur = "var(--brand)",
  colorPrev = "#cbd5e1",
  labelCur,
  labelPrev,
}: {
  cur: number[];
  prev: number[];
  unit: Unit;
  colorCur?: string;
  colorPrev?: string;
  labelCur: string;
  labelPrev: string;
}) {
  const len = Math.max(cur.length, prev.length);
  const c = Array.from({ length: len }, (_, i) => cur[i] ?? 0);
  const p = Array.from({ length: len }, (_, i) => prev[i] ?? 0);
  const dataMax = Math.max(1, ...c, ...p);
  const { max: axisMax, step } = niceScale(dataMax, 4);
  const ticks = Array.from({ length: 5 }, (_, i) => step * i); // 0 … axisMax

  return (
    <>
      <div className="mchart">
        {/* 좌측 금액 눈금(Y축) */}
        <div className="mchart__y">
          {ticks.slice().reverse().map((t) => (
            <span className="mchart__ytick" key={t}>{axisLabel(t, unit)}</span>
          ))}
        </div>
        <div className="mchart__body">
          <div className="mchart__plot">
            {/* 가로 격자선 */}
            {ticks.map((t) => (
              <div className="mchart__grid" key={t} style={{ bottom: `${(t / axisMax) * 100}%` }} />
            ))}
            {/* 막대 */}
            <div className="mchart__bars">
              {Array.from({ length: len }, (_, i) => (
                <div className="mchart__col" key={i}>
                  <div
                    className="mchart__bar"
                    style={{ height: `${(p[i] / axisMax) * 100}%`, background: colorPrev }}
                    title={`${labelPrev} ${i + 1}월: ${fmt(p[i], unit)}`}
                  />
                  <div
                    className="mchart__bar"
                    style={{ height: `${(c[i] / axisMax) * 100}%`, background: colorCur }}
                    title={`${labelCur} ${i + 1}월: ${fmt(c[i], unit)}${i === cur.length - 1 ? " (진행 중)" : ""}`}
                  />
                </div>
              ))}
            </div>
          </div>
          {/* 월 라벨 */}
          <div className="mchart__x">
            {Array.from({ length: len }, (_, i) => (
              <span className="mchart__xtick" key={i}>
                {i + 1}월{i === cur.length - 1 ? "*" : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="chart__legend">
        <span>
          <i className="dot" style={{ background: colorCur }} /> {labelCur}
        </span>
        <span>
          <i className="dot" style={{ background: colorPrev }} /> {labelPrev}
        </span>
        <span className="chart__note">* 표시 월은 진행 중(오늘까지)</span>
      </div>
    </>
  );
}

// YoY(올해 vs 작년) 차트 카드
function YoYChart({ series }: { series: Mseries }) {
  const y = ytd(series);
  const g = growth(y.cur, y.prev);
  return (
    <section className="card card--wide">
      <div className="ov__chart-head">
        <h2 className="card__title">{series.label} — 월별 추이</h2>
        <span className={`metric__badge metric__badge--${g.tone}`}>
          {g.tone === "up" ? "▲" : g.tone === "down" ? "▼" : ""} {g.text}
        </span>
      </div>
      {/* 총매출 차트의 구분 선택줄과 높이 맞춤(월 기준선 정렬) */}
      <div className="ov__cat-picker ov__cat-picker--ghost" aria-hidden />
      <MonthBars
        cur={series.cur}
        prev={series.prev}
        unit={series.unit}
        labelCur={`${YEAR}년`}
        labelPrev={`${PREV_YEAR}년`}
      />
    </section>
  );
}

// 총 매출 차트 — 구분(장비/라이선스/기타) 체크박스로 선택해 비교
function TotalSalesChart({
  curByCat,
  lastMonth,
}: {
  curByCat: Record<string, number[]> | null;
  lastMonth: number;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(SALES_CATS));
  const toggle = (c: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n.size ? n : prev; // 최소 1개는 유지
    });
  const cats = SALES_CATS.filter((c) => sel.has(c));
  const cur = curByCat && lastMonth > 0 ? sumCats(curByCat, cats, lastMonth) : [];
  const prev = sumCats(SALES_2025, cats, 12);
  const series: Mseries = { key: "total", label: "총 매출", unit: "won", sample: false, cur, prev };
  const y = ytd(series);
  const g = growth(y.cur, y.prev);
  const allOn = cats.length === SALES_CATS.length;
  return (
    <section className="card card--wide">
      <div className="ov__chart-head">
        <h2 className="card__title">총 매출 — 월별 추이</h2>
        <span className={`metric__badge metric__badge--${g.tone}`}>
          {g.tone === "up" ? "▲" : g.tone === "down" ? "▼" : ""} {g.text}
        </span>
      </div>
      <div className="ov__cat-picker">
        <span className="ov__cat-picker-label">구분</span>
        {SALES_CATS.map((c) => (
          <label key={c} className={`ov__cat${sel.has(c) ? " ov__cat--on" : ""}`}>
            <input type="checkbox" checked={sel.has(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
        <span className="ov__cat-sel">{allOn ? "전체(총매출)" : cats.join(" + ")}</span>
      </div>
      <MonthBars
        cur={series.cur}
        prev={series.prev}
        unit="won"
        labelCur={`${YEAR}년`}
        labelPrev={`${PREV_YEAR}년`}
      />
    </section>
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

// 유튜브 조회수 KPI용 (실제값은 /api/youtube override 로 채움)
const YT_VIEWS: Mseries = { key: "ytviews", label: "유튜브 조회수", unit: "views", sample: false, cur: [], prev: [] };

export function Overview() {
  // 유튜브 채널 지표(실데이터)
  const [yt, setYt] = useState<YoutubeStats | null>(null);
  useEffect(() => {
    fetchYoutube().then(setYt).catch(() => {});
  }, []);

  // CMS 매출(효성CMS 실데이터) — 없으면 정적 cms 폴백
  const [cmsView, setCmsView] = useState<Mseries>(cms);
  useEffect(() => {
    fetchCms()
      .then((d) => {
        if (d.cur || d.prev) setCmsView({ ...cms, sample: false, cur: d.cur ?? cms.cur, prev: d.prev ?? cms.prev });
      })
      .catch(() => {});
  }, []);

  // 총 매출(노션 장비매출 DB, 구분별 실데이터)
  const [sales, setSales] = useState<SalesMonthly | null>(null);
  useEffect(() => {
    fetchSalesMonthly().then(setSales).catch(() => {});
  }, []);
  // 핵심요약 KPI: 전체(장비+라이선스+기타) 총매출
  const totalCur =
    sales && sales.lastMonth > 0
      ? sumCats(sales.curByCat, SALES_CATS, sales.lastMonth)
      : totalSales.cur;
  const totalSeries: Mseries = { ...totalSales, cur: totalCur };

  return (
    <div className="ov">
      <div className="ov__banner">
        대표님 경영 의사결정용 핵심 지표 요약 · {YEAR}년 vs {PREV_YEAR}년 동기 비교
        <span>· 총매출/CMS/VAN은 실데이터, “샘플” 표시 지표는 임의 데이터</span>
      </div>

      {/* ===== 핵심 요약 ===== */}
      <section className="ov__sec">
        <SecHead title="핵심 요약" note="올해 누적(YTD) · 작년 동기간 대비" />
        <div className="ov__row">
          <Kpi icon="💰" series={totalSeries} hint="장비+라이선스+기타 · 올해 누적 · 작년 동기 대비" />
          <Kpi icon="💳" series={cmsView} />
          <Kpi icon="🔁" series={van} />
          <Kpi
            icon="📺"
            series={YT_VIEWS}
            noCompare
            override={{
              cur: yt?.totalViews ?? 0,
              prev: 0,
              value: yt ? `${yt.totalViews.toLocaleString("ko-KR")}회` : "…",
            }}
            hint={
              yt
                ? `채널 누적 조회수 · 구독자 ${yt.subscribers.toLocaleString("ko-KR")}명 · 영상 ${yt.videoCount}개`
                : "유튜브 불러오는 중…"
            }
          />
        </div>
      </section>

      {/* ===== 매출 ===== */}
      <section className="ov__sec">
        <SecHead title="매출 현황" note="총매출(장비·라이선스·기타) · CMS" />
        <div className="ov__charts">
          <TotalSalesChart curByCat={sales?.curByCat ?? null} lastMonth={sales?.lastMonth ?? 0} />
          <YoYChart series={cmsView} />
        </div>
      </section>

      {/* ===== 거래(VAN) ===== */}
      <section className="ov__sec">
        <SecHead title="거래(VAN) 건수" note="DAOU · KOVAN · KICC 합산" />
        <div className="ov__row">
          <Kpi icon="🟦" series={daou} hint={`DAOU · ${YEAR}년 누적`} />
          <Kpi icon="🟩" series={kovan} hint={`KOVAN · ${YEAR}년 누적`} />
          <Kpi icon="🟧" series={kicc} hint={`KICC · ${YEAR}년 누적`} />
        </div>
        <YoYChart series={van} />
      </section>

      {/* ===== 유튜브 ===== */}
      <section className="ov__sec">
        <SecHead title="유튜브" note="유튜브 채널 지표" />
        <YoutubeCard />
      </section>
    </div>
  );
}
