import { useEffect, useState } from "react";
import { won, growth } from "../lib/format";
import { fetchCms } from "../lib/cms";
import { fetchSalesMonthly, type SalesMonthly } from "../lib/sales";
import { fetchTr, trMonthly, type TrData } from "../lib/tr";
import { fetchTerminals, type TerminalUsage, type VanTerminals, type MerchantsSummary } from "../lib/terminals";
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
export function MonthBars({
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
export function TotalSalesChart({
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

// 사업자번호 10자리 → XXX-XX-XXXXX
const fmtBiz = (b: string) => (b && /^\d{10}$/.test(b) ? `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}` : b || "-");

// 미사용 명단 모달(상호/사업자번호). 단말기 명단은 단말기번호 컬럼 표시, 가맹점 명단은 생략.
function IdleModal({ title, list, note, onClose }: { title: string; list: Array<{ tid?: string; bizno: string; name: string }>; note?: string; onClose: () => void }) {
  const hasTid = list.some((x) => x.tid);
  return (
    <div className="idle-modal" onClick={onClose}>
      <div className="idle-modal__box" onClick={(e) => e.stopPropagation()}>
        <div className="idle-modal__head">
          <h3>{title}</h3>
          <button className="idle-modal__x" onClick={onClose}>✕</button>
        </div>
        {note && <div className="idle-modal__note">{note}</div>}
        <div className="idle-modal__list">
          <table>
            <thead><tr><th>#</th><th>상호명</th><th>사업자번호</th>{hasTid && <th>단말기번호</th>}</tr></thead>
            <tbody>
              {list.map((x, i) => (
                <tr key={(x.tid ?? x.bizno) + "_" + i}>
                  <td>{i + 1}</td>
                  <td>{x.name || "-"}</td>
                  <td>{fmtBiz(x.bizno)}</td>
                  {hasTid && <td>{x.tid}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 운영 가맹점 수 카드(사업자번호 distinct: 개통/사용/미사용) — 코밴·다우·통합. 미사용 클릭 시 명단
function MerchantCard({ m }: { m: MerchantsSummary }) {
  const [showIdle, setShowIdle] = useState(false);
  const c = m.combined;
  const idleList = m.idleList ?? [];
  const canDrill = idleList.length > 0;
  return (
    <div className="tcard tcard--merch">
      <div className="tcard__van">🏪 운영 가맹점 (코밴+다우 통합)</div>
      <div className="tcard__nums">
        <div><b>{c.opened.toLocaleString("ko-KR")}</b><span>개통</span></div>
        <div><b style={{ color: "#16a34a" }}>{c.used.toLocaleString("ko-KR")}</b><span>운영(7일)</span></div>
        <div
          className={`tcard__idle${canDrill ? " tcard__idle--btn" : ""}`}
          onClick={canDrill ? () => setShowIdle(true) : undefined}
          title={canDrill ? "클릭하면 미사용 가맹점 명단(상호·사업자번호)" : undefined}
        >
          <b>{c.idle.toLocaleString("ko-KR")}</b><span>미사용{canDrill ? " ▸" : ""}</span>
        </div>
      </div>
      {showIdle && (
        <IdleModal
          title={`미사용 가맹점 ${idleList.length}곳 (7일 미결제)`}
          list={idleList}
          note="코밴·다우 통틀어 최근 7일 결제가 없는 가맹점입니다. 한쪽에서라도 결제가 있으면 제외됩니다."
          onClose={() => setShowIdle(false)}
        />
      )}
      <div className="tcard__basis">
        운영 기준 코밴 {m.kovan?.used?.toLocaleString("ko-KR") ?? "-"} · 다우 {m.ddwm?.used?.toLocaleString("ko-KR") ?? "-"} (사업자번호 distinct · 양쪽 사용 가맹점 중복 제거 · KICC 제외)
      </div>
    </div>
  );
}

// 단말기 사용현황 카드(VAN별: 개통/사용/미사용) — 미사용 클릭 시 매장 명단
function VanTerminalCard({ label, t }: { label: string; t: VanTerminals | null | undefined }) {
  const [showIdle, setShowIdle] = useState(false);
  if (!t || t.error) {
    return (
      <div className="tcard">
        <div className="tcard__van">{label}</div>
        <div className="tcard__basis">{t?.error ? "수집 오류" : "수집 전"}</div>
      </div>
    );
  }
  const pct = t.opened ? Math.round((t.idle / t.opened) * 100) : 0;
  const idleList = t.idleList ?? [];
  const canDrill = idleList.length > 0;
  return (
    <div className="tcard">
      <div className="tcard__van">
        {label}
        {!t.precise && <span className="tcard__approx">월 근사</span>}
      </div>
      <div className="tcard__nums">
        <div><b>{t.opened.toLocaleString("ko-KR")}</b><span>개통</span></div>
        <div><b>{t.used.toLocaleString("ko-KR")}</b><span>사용</span></div>
        <div
          className={`tcard__idle${canDrill ? " tcard__idle--btn" : ""}`}
          onClick={canDrill ? () => setShowIdle(true) : undefined}
          title={canDrill ? "클릭하면 미사용 매장 명단(상호·사업자번호)" : undefined}
        >
          <b>{t.idle.toLocaleString("ko-KR")}</b><span>미사용{canDrill ? " ▸" : ""}</span>
        </div>
      </div>
      <div className="tcard__basis">미사용율 {pct}% · {t.basis}</div>
      {showIdle && (
        <IdleModal
          title={`${label} · 미사용 매장 ${idleList.length}곳`}
          list={idleList}
          onClose={() => setShowIdle(false)}
        />
      )}
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

export function Overview() {

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

  // 거래(VAN) 건수 — 코밴·다우 라이브(/api/tr), KICC는 정적 폴백
  const [tr, setTr] = useState<TrData | null>(null);
  useEffect(() => {
    fetchTr().then(setTr).catch(() => {});
  }, []);

  // 단말기 사용현황(개통/사용/휴면)
  const [term, setTerm] = useState<TerminalUsage | null>(null);
  useEffect(() => {
    fetchTerminals().then(setTerm).catch(() => {});
  }, []);
  const kov = tr ? trMonthly(tr, "kovanCount") : null;
  const dao = tr ? trMonthly(tr, "ddwmCount") : null;
  const kovanV: Mseries = kov
    ? { ...kovan, cur: kov.cur12.slice(0, kov.lastMonth), prev: kov.prev12 }
    : kovan;
  const daouV: Mseries = dao
    ? { ...daou, cur: dao.cur12.slice(0, dao.lastMonth), prev: dao.prev12 }
    : daou;
  const vanV: Mseries =
    kov && dao
      ? {
          ...van,
          cur: Array.from({ length: Math.max(kov.lastMonth, dao.lastMonth) }, (_, i) =>
            kov.cur12[i] + dao.cur12[i] + (kicc.cur[i] ?? 0)
          ),
          prev: Array.from({ length: 12 }, (_, i) =>
            kov.prev12[i] + dao.prev12[i] + (kicc.prev[i] ?? 0)
          ),
        }
      : van;

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
          <Kpi icon="🔁" series={vanV} />
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
        <SecHead title="거래(VAN) 건수" note="DAOU · KOVAN(실데이터) · KICC 합산" />
        <div className="ov__row">
          <Kpi icon="🟦" series={daouV} hint={`DAOU · ${YEAR}년 누적`} />
          <Kpi icon="🟩" series={kovanV} hint={`KOVAN · ${YEAR}년 누적`} />
          <Kpi icon="🟧" series={kicc} hint={`KICC · ${YEAR}년 누적(참고)`} />
        </div>
        <YoYChart series={vanV} />
      </section>

      {/* ===== 단말기 사용현황 + 운영 가맹점 수 (한 줄) ===== */}
      <section className="ov__sec">
        <SecHead title="단말기 · 가맹점 사용현황" note="개통 · 사용(최근 7일 결제) · 미사용(7일 이상 미결제) · 미사용 클릭 시 매장 명단" />
        <div className="ov__row">
          <VanTerminalCard label="🟩 코밴" t={term?.kovan} />
          <VanTerminalCard label="🟦 다우" t={term?.ddwm} />
          {term?.merchants && <MerchantCard m={term.merchants} />}
        </div>
      </section>
    </div>
  );
}
