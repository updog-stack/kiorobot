import { useEffect, useMemo, useState } from "react";
import { fetchCalls, type CallsData, type CallSeries, type CallItem } from "../lib/calls";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const RANGES = [
  { days: 1, label: "오늘" },
  { days: 7, label: "최근 7일" },
  { days: 30, label: "최근 30일" },
];

export function CallHeatmap() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<CallsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState("all");
  const [modal, setModal] = useState<{ title: string; items: CallItem[] } | null>(null);

  async function load(d = days) {
    setLoading(true);
    try {
      setData(await fetchCalls(d));
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const byId = (id: string): CallSeries | undefined => data?.series.find((s) => s.id === id);
  const view = useMemo(() => byId(scope) ?? data?.series[0], [data, scope]);

  const activeHours = useMemo(() => {
    if (!view) return HOURS;
    const cols = HOURS.filter((h) => view.grid.some((row) => row[h] > 0));
    if (!cols.length) return HOURS.filter((h) => h >= 8 && h <= 20);
    return HOURS.filter((h) => h >= Math.min(...cols) && h <= Math.max(...cols));
  }, [view]);

  if (error && !data) return <div className="state state--error">불러오기 실패: {error}</div>;
  if (!data || !view) return <div className="state">인입 현황을 불러오는 중…</div>;

  const cellColor = (n: number) => {
    if (!n) return "transparent";
    const a = 0.15 + 0.85 * (n / Math.max(1, view.max));
    return `rgba(99, 102, 241, ${a.toFixed(3)})`;
  };

  const kpiIds = ["all", "phoneIn", "phoneOut", "chat", "dain", "amudo"];

  return (
    <div className="sales">
      <div className="sales__toolbar">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.days} className={days === r.days ? "is-active" : ""} onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="sales__updated">
          {data.updatedAt && `갱신 ${new Date(data.updatedAt).toLocaleString("ko-KR")}`}
        </span>
        <button className="sync-btn" onClick={() => load()} disabled={loading}>
          {loading ? "조회 중…" : "↻ 조회"}
        </button>
      </div>

      {error && <div className="state state--error">조회 실패: {error}</div>}
      {data.source !== "channeltalk" && <div className="state">{data.note || "채널톡 연동 필요"}</div>}

      <div className="sales__kpis">
        {kpiIds.map((id) => {
          const s = byId(id);
          if (!s) return null;
          return (
            <section
              className="metric metric--btn"
              key={id}
              role="button"
              onClick={() => setModal({ title: `${id === "all" ? "전체 인입" : s.label} (${s.total}건)`, items: s.items })}
            >
              <div className="metric__label">
                {id === "all" ? "전체" : s.label}
              </div>
              <div className="metric__amount">{s.total.toLocaleString("ko-KR")}건</div>
              <div className="metric__hint">
                {id === "all"
                  ? `최근 ${data.days}일`
                  : id === "phoneIn" || id === "phoneOut" || id === "chat"
                  ? "매체별"
                  : "브랜드(번호·태그)"}
              </div>
            </section>
          );
        })}
      </div>

      <div className="van-tabs">
        {data.series.map((s) => (
          <button key={s.id} className={scope === s.id ? "is-active" : ""} onClick={() => setScope(s.id)}>
            {s.id === "all" ? "전체" : s.label} ({s.total})
          </button>
        ))}
      </div>

      <section className="card card--wide">
        <h2 className="card__title">요일 · 시간대별 인입 수 — {view.id === "all" ? "전체" : view.label}</h2>
        <div className="heat">
          <table className="heat__table">
            <thead>
              <tr>
                <th className="heat__corner"></th>
                {activeHours.map((h) => (
                  <th key={h} className="heat__hour">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WD.map((d, wd) => (
                <tr key={wd}>
                  <th className="heat__wd">{d}</th>
                  {activeHours.map((h) => {
                    const n = view.grid[wd][h];
                    return (
                      <td
                        key={h}
                        className="heat__cell"
                        style={{ background: cellColor(n) }}
                        title={`${d}요일 ${h}시 · ${n}건`}
                      >
                        {n > 0 ? n : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="heat__legend">
            <span>0</span>
            <i className="heat__bar" />
            <span>{view.max}</span>
          </div>
        </div>
      </section>

      {modal && (
        <div className="modal__backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h3 className="modal__title">{modal.title}</h3>
              <button className="modal__close" onClick={() => setModal(null)}>✕</button>
            </div>
            {modal.items.length === 0 ? (
              <div className="state">내역이 없습니다.</div>
            ) : (
              <ul className="modal__list">
                {modal.items.map((c, i) => (
                  <li key={i}>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      <span>
                        <span className={`call-medium call-medium--${c.medium.startsWith("전화") ? "phone" : "chat"}`}>{c.medium}</span>
                        {" "}{c.name}
                        {c.tags && <span className="call-tags"> · {c.tags}</span>}
                      </span>
                      <span className="modal__link">열기 ↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
