import { useEffect, useState } from "react";
import { won, growth } from "../lib/format";
import { fetchCms } from "../lib/cms";
import { fetchSalesMonthly, type SalesMonthly } from "../lib/sales";
import { fetchTr, trMonthly, type TrData } from "../lib/tr";
import { fetchTerminals, fetchBizStatus, fetchMerchantOpenings, fetchTerminalTotal, type TerminalUsage, type MerchCount, type IdleMerchant, type BizStatus, type MerchantOpenings, type TerminalTotal } from "../lib/terminals";
import { Scoreboard, vanAmtSeries } from "./ManagementMetrics";
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
const fmtDt = (d: string) => (d && d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d);
// 국세청 상태 → 라벨/색
function bizStatusLabel(s?: BizStatus): { text: string; color: string } {
  if (!s || !s.b_stt) return { text: "-", color: "var(--muted)" };
  if (s.b_stt_cd === "03" || s.b_stt.includes("폐업")) return { text: s.end_dt ? `폐업 (${fmtDt(s.end_dt)})` : "폐업", color: "#dc2626" };
  if (s.b_stt_cd === "02" || s.b_stt.includes("휴업")) return { text: "휴업", color: "#d97706" };
  return { text: "정상", color: "#16a34a" };
}

// 미사용 명단 모달(상호/사업자번호 + 국세청 폐업여부). 단말기 명단은 단말기번호 컬럼 표시.
function IdleModal({ title, list, note, onClose }: { title: string; list: Array<{ tid?: string; bizno: string; name: string }>; note?: string; onClose: () => void }) {
  const hasTid = list.some((x) => x.tid);
  const [status, setStatus] = useState<Record<string, BizStatus>>({});
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let alive = true;
    const biznos = [...new Set(list.map((x) => x.bizno).filter(Boolean))];
    fetchBizStatus(biznos)
      .then((s) => alive && setStatus(s))
      .catch(() => {})
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [list]);

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
            <thead><tr><th>#</th><th>상호명</th><th>사업자번호</th><th>폐업여부</th>{hasTid && <th>단말기번호</th>}</tr></thead>
            <tbody>
              {list.map((x, i) => {
                const st = bizStatusLabel(status[x.bizno]);
                return (
                  <tr key={(x.tid ?? x.bizno) + "_" + i}>
                    <td>{i + 1}</td>
                    <td>{x.name || "-"}</td>
                    <td>{fmtBiz(x.bizno)}</td>
                    <td style={{ color: st.color, fontWeight: st.text.startsWith("폐업") ? 700 : 400, whiteSpace: "nowrap" }}>
                      {checking ? "조회 중…" : st.text}
                    </td>
                    {hasTid && <td>{x.tid}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 가맹점(사업자번호·30일) 카드 — 코밴/다우/전체 공통. 운영(30일)/최근7일/최근미결제(클릭 시 명단).
function MerchStatCard({ label, merch, idleList, basis, note, headLabel = "운영(30일)" }: {
  label: string;
  merch: MerchCount | null | undefined;
  idleList: IdleMerchant[];
  basis: string;
  note?: string;
  headLabel?: string;
}) {
  const [showIdle, setShowIdle] = useState(false);
  if (!merch) {
    return (
      <div className="tcard tcard--merch">
        <div className="tcard__van">{label}</div>
        <div className="tcard__basis">수집 전</div>
      </div>
    );
  }
  const canDrill = idleList.length > 0;
  return (
    <div className="tcard tcard--merch">
      <div className="tcard__van">{label}</div>
      <div className="tcard__nums">
        <div><b style={{ color: "#16a34a" }}>{merch.opened.toLocaleString("ko-KR")}</b><span>{headLabel}</span></div>
        <div><b>{merch.used.toLocaleString("ko-KR")}</b><span>최근7일</span></div>
        <div
          className={`tcard__idle${canDrill ? " tcard__idle--btn" : ""}`}
          onClick={canDrill ? () => setShowIdle(true) : undefined}
          title={canDrill ? "클릭하면 최근 7일 무결제 가맹점 명단(상호·사업자번호)" : undefined}
        >
          <b>{merch.idle.toLocaleString("ko-KR")}</b><span>최근미결제{canDrill ? " ▸" : ""}</span>
        </div>
      </div>
      {showIdle && (
        <IdleModal
          title={`${label} · 최근 7일 무결제 가맹점 ${idleList.length}곳`}
          list={idleList}
          note={note}
          onClose={() => setShowIdle(false)}
        />
      )}
      <div className="tcard__basis">{basis}</div>
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
  // 장비 매출(총매출 중 장비 구분만)
  const equipCur =
    sales && sales.lastMonth > 0 ? (sales.curByCat["장비"] ?? []).slice(0, sales.lastMonth) : totalSales.cur;
  const equipSeries: Mseries = { key: "equip", label: "장비 매출", unit: "won", cur: equipCur, prev: SALES_2025["장비"] };

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
  // 신규 가맹점 개설 추이(개설일 기준)
  const [openings, setOpenings] = useState<MerchantOpenings | null>(null);
  const [openTab, setOpenTab] = useState<"new" | "total">("new"); // 신규 개설 / 전체 가맹점(운영 누적)
  useEffect(() => {
    fetchMerchantOpenings().then(setOpenings).catch(() => {});
  }, []);
  // 누적 거래실적(거래 단말기 + 거래 가맹점)
  const [termTotal, setTermTotal] = useState<TerminalTotal | null>(null);
  useEffect(() => {
    fetchTerminalTotal().then(setTermTotal).catch(() => {});
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

  // 성과 점수용 지표(작년=100점) — 총매출·CMS·VAN 결제금액(라이브)
  const vanAmtM: Mseries | null = tr ? vanAmtSeries(tr) : null;
  const scoreMetrics = [
    { s: totalSeries, icon: "💰" },
    { s: equipSeries, icon: "🖥️" },
    { s: cmsView, icon: "💳" },
    ...(vanAmtM ? [{ s: vanAmtM, icon: "🔁" }] : []),
  ];

  return (
    <div className="ov">
      <div className="ov__banner">
        대표님 경영 대시보드 · {YEAR}년 vs {PREV_YEAR}년 동기 비교 · 성과 점수(작년=100점) · 핵심 지표
        <span>· 총매출·CMS·VAN·가맹점은 실데이터. VAN 결제금액 중 코밴 작년 일부는 건수기반 예측</span>
      </div>

      {/* ===== 성과 점수(작년=100점) ===== */}
      <Scoreboard metrics={scoreMetrics} />

      {/* ===== 핵심 요약 ===== */}
      <section className="ov__sec">
        <SecHead title="핵심 요약" note="올해 누적(YTD) · 작년 동기간 대비 · 연말 예상" />
        <div className="ov__row">
          <Kpi icon="💰" series={totalSeries} hint="장비+라이선스+기타 · 올해 누적 · 작년 동기 대비" />
          <Kpi icon="🖥️" series={equipSeries} hint="총매출 중 장비 구분 · 올해 누적 · 작년 동기 대비" />
          <Kpi icon="💳" series={cmsView} />
          <Kpi icon="🔁" series={vanV} />
          {vanAmtM && <Kpi icon="💵" series={vanAmtM} hint="코밴+다우 결제금액(거래대금)" />}
        </div>
      </section>

      {/* 매출 현황 차트는 '매출현황' 메뉴로 이관(중복 제거) */}

      {/* ===== 단말기 사용현황 + 운영 가맹점 수 (한 줄) ===== */}
      <section className="ov__sec">
        <SecHead title="가맹점 사용현황" note="모두 사업자번호(가맹점) 기준 · 운영=최근 30일 결제 · 최근미결제(7일) 클릭 시 명단 · 아래 차트는 개설월별 추이" />
        <div className="ov__row">
          {termTotal?.merchants && (
            <div className="tcard tcard--merch">
              <div className="tcard__van">📈 누적 가맹점수 <span style={{ fontWeight: 400, fontSize: 11, color: "var(--muted)" }}>· KICC 제외</span></div>
              <div className="tcard__nums">
                <div><b>{termTotal.merchants.total.toLocaleString("ko-KR")}</b><span>거래 가맹점</span></div>
              </div>
              <div className="tcard__basis">역대 실제 거래 · 코밴 {termTotal.merchants.kovan.toLocaleString("ko-KR")} · 다우 {termTotal.merchants.ddwm.toLocaleString("ko-KR")} · 중복 제거 · KICC 제외</div>
            </div>
          )}
          {termTotal?.terminals && (
            <div className="tcard tcard--merch">
              <div className="tcard__van">📟 누적 단말기수 <span style={{ fontWeight: 400, fontSize: 11, color: "var(--muted)" }}>· KICC 제외</span></div>
              <div className="tcard__nums">
                <div><b>{termTotal.terminals.total.toLocaleString("ko-KR")}</b><span>거래 단말기</span></div>
              </div>
              <div className="tcard__basis">역대 실제 거래 · 코밴 {termTotal.terminals.kovan.toLocaleString("ko-KR")} · 다우 {termTotal.terminals.ddwm.toLocaleString("ko-KR")} · KICC 제외</div>
            </div>
          )}
          <MerchStatCard
            label="🟩 코밴"
            merch={term?.merchants?.kovan}
            idleList={term?.merchants?.kovanIdle ?? []}
            basis={`단말기 ${term?.kovan?.opened?.toLocaleString("ko-KR") ?? "-"}개 · 사업자번호 distinct · 최근 30일`}
            note="최근 30일엔 결제가 있었으나 최근 7일간 결제가 없는 가맹점입니다."
          />
          <MerchStatCard
            label="🟦 다우"
            merch={term?.merchants?.ddwm}
            idleList={term?.merchants?.ddwmIdle ?? []}
            basis={`단말기 ${term?.ddwm?.opened?.toLocaleString("ko-KR") ?? "-"}개 · 사업자번호 distinct · 최근 30일`}
            note="최근 30일엔 결제가 있었으나 최근 7일간 결제가 없는 가맹점입니다."
          />
          <MerchStatCard
            label="🏪 전체 (운영·최근 30일)"
            merch={term?.merchants?.combined}
            idleList={term?.merchants?.idleList ?? []}
            basis={`코밴 ${term?.merchants?.kovan?.opened?.toLocaleString("ko-KR") ?? "-"} · 다우 ${term?.merchants?.ddwm?.opened?.toLocaleString("ko-KR") ?? "-"}${term?.merchants?.kicc ? ` · KICC ${term.merchants.kicc}` : ""} · 중복 제거`}
            note="코밴·다우 통틀어 최근 7일 결제가 없는 가맹점입니다. 한쪽에서라도 결제가 있으면 제외됩니다."
            headLabel="전체(30일)"
          />
        </div>

        {/* 가맹점 추이 — 신규 개설 / 전체 가맹점(누적) 필터 (개설일 기준 · 코밴+다우 중복제거) */}
        {openings?.combined?.[String(YEAR)] && (() => {
          const nMonths = new Date().getMonth() + 1;
          const isTotal = openTab === "total"; // 전체 가맹점(운영 누적 →842)
          // 신규=전체 개설(combined) · 전체 가맹점=현재 운영 기준(operating)
          const src = (isTotal ? openings.operating : openings.combined) ?? openings.combined;
          const monthly = (yr: number) => src[String(yr)] ?? [];
          const beforeYear = (yr: number) =>
            Object.keys(src)
              .map(Number)
              .filter((y) => y < yr)
              .reduce((s, y) => s + monthly(y).reduce((a, b) => a + b, 0), 0);
          const cumulative = (yr: number) => {
            let run = beforeYear(yr);
            return Array.from({ length: 12 }, (_, i) => (run += monthly(yr)[i] ?? 0, run));
          };
          const cur = (isTotal ? cumulative(YEAR) : monthly(YEAR)).slice(0, nMonths);
          const prev = isTotal ? cumulative(PREV_YEAR) : monthly(PREV_YEAR);
          return (
            <section className="card card--wide" style={{ marginTop: 16 }}>
              <div className="ov__chart-head">
                <h2 className="card__title">
                  {isTotal ? "전체 가맹점 추이" : "신규 가맹점 개설 추이"} — {YEAR}년 vs {PREV_YEAR}년{" "}
                  <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>
                    (개설월별 · 코밴+다우 중복 제거 · {isTotal ? "현재 운영 가맹점 누적(현재월=842)" : "그 달 개설 전부"})
                  </span>
                </h2>
                <div className="seg">
                  <button className={openTab === "new" ? "is-active" : ""} onClick={() => setOpenTab("new")}>신규 개설</button>
                  <button className={openTab === "total" ? "is-active" : ""} onClick={() => setOpenTab("total")}>전체 가맹점</button>
                </div>
              </div>
              <MonthBars cur={cur} prev={prev} unit="count" labelCur={`${YEAR}년`} labelPrev={`${PREV_YEAR}년`} />
            </section>
          );
        })()}
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
    </div>
  );
}
