import { useMemo, useState, useEffect } from "react";
import { fetchTr, syncTr, type TrData, type TrMonth } from "../lib/tr";

const cnt = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}건`;

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
    if (!data) return { monthly: [] as TrMonth[], total: 0, avg: 0 };
    if (scope === "all") return data.combined;
    const v = data.vans.find((x) => x.van === scope);
    return v ? { monthly: v.monthly, total: v.total, avg: v.avg } : { monthly: [], total: 0, avg: 0 };
  }, [data, scope]);

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
  if (!data) return <div className="state">TR현황 데이터를 불러오는 중…</div>;

  const empty = data.vans.length === 0;
  const currentMonth = view.monthly.length ? view.monthly[view.monthly.length - 1] : null;

  return (
    <div className="sales">
      <div className="sales__toolbar">
        {data.updatedAt && (
          <span className="sales__updated">수집 {new Date(data.updatedAt).toLocaleString("ko-KR")}</span>
        )}
        {syncButton}
      </div>

      {syncError && <div className="state state--error">동기화 실패: {syncError}</div>}
      {data.syncWarning && <div className="state state--error">일부 실패: {data.syncWarning}</div>}
      {syncing && <div className="state">로그인 → 조회 중… (다우데이타는 이메일 인증·월별 조회로 1~2분 소요)</div>}
      {empty && !syncing && (
        <div className="state">아직 수집 전입니다. '지금 동기화' 또는 매일 08:00 자동 수집 후 표시됩니다.</div>
      )}

      <div className="van-tabs">
        <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>
          합산 ({cnt(data.combined.total)})
        </button>
        {data.vans.map((v) => (
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
            {data.year}년 1월~{currentMonth ? `${currentMonth.month}월` : "현재"} · {scope === "all" ? "코밴+다우데이타" : scope}
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
          월별 거래 건수 — {scope === "all" ? "합산(코밴+다우데이타)" : data.vans.find((v) => v.van === scope)?.label}
        </h2>
        <Chart monthly={view.monthly} />
      </section>
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
