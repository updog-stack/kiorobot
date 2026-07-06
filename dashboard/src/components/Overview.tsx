import { useEffect, useState } from "react";
import { won, growth } from "../lib/format";
import { YoutubeCard } from "./YoutubeCard";
import { fetchYoutube, type YoutubeStats } from "../lib/youtube";
import { fetchCms } from "../lib/cms";
import {
  YEAR,
  PREV_YEAR,
  ytd,
  fmtCount,
  type Mseries,
  type Unit,
  equipment,
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

// ===== 월별 막대 (올해 vs 작년, 또는 임의 2계열) =====
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
  const max = Math.max(1, ...c, ...p);

  return (
    <>
      <div className="chart">
        {Array.from({ length: len }, (_, i) => {
          const isLast = i === cur.length - 1;
          return (
            <div className="chart__col" key={i}>
              <div className="chart__bars" title={`${i + 1}월`}>
                <div
                  className="chart__bar"
                  style={{
                    height: `${(p[i] / max) * 100}%`,
                    background: colorPrev,
                  }}
                  title={`${labelPrev} ${i + 1}월: ${fmt(p[i], unit)}`}
                />
                <div
                  className="chart__bar"
                  style={{
                    height: `${(c[i] / max) * 100}%`,
                    background: colorCur,
                  }}
                  title={`${labelCur} ${i + 1}월: ${fmt(c[i], unit)}${
                    isLast ? " (진행 중)" : ""
                  }`}
                />
              </div>
              <div className="chart__xlabel">
                {i + 1}월{i === cur.length - 1 ? "*" : ""}
              </div>
            </div>
          );
        })}
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

  return (
    <div className="ov">
      <div className="ov__banner">
        대표님 경영 의사결정용 핵심 지표 요약 · {YEAR}년 vs {PREV_YEAR}년 동기 비교
        <span>· 장비/CMS/VAN은 실데이터 예시, “샘플” 표시 지표는 임의 데이터</span>
      </div>

      {/* ===== 핵심 요약 ===== */}
      <section className="ov__sec">
        <SecHead title="핵심 요약" note="올해 누적(YTD) · 작년 동기간 대비" />
        <div className="ov__row">
          <Kpi icon="🖥️" series={equipment} />
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
        <SecHead title="매출 현황" note="장비 · CMS · 매출 구성" />
        <div className="ov__charts">
          <YoYChart series={equipment} />
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
