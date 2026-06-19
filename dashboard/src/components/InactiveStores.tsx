import { useEffect, useMemo, useState } from "react";
import { fetchInactive, syncInactive, checkInactive, statusLabel, type InactiveData } from "../lib/inactive";

export function InactiveStores() {
  const [data, setData] = useState<InactiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [scope, setScope] = useState("all"); // "all" | van
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    fetchInactive()
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
      setData(await syncInactive());
    } catch (e) {
      setSyncError(String(e instanceof Error ? e.message : e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      setData(await checkInactive());
    } catch (e) {
      setCheckError(String(e instanceof Error ? e.message : e));
    } finally {
      setChecking(false);
    }
  }

  const view = useMemo(() => {
    if (!data) return { stores: [], count: 0, uniqueBiz: 0 };
    if (scope === "all") {
      return {
        stores: data.vans.flatMap((v) => v.stores),
        count: data.combinedCount,
        uniqueBiz: data.combinedUniqueBiz,
      };
    }
    const v = data.vans.find((x) => x.van === scope);
    return { stores: v?.stores ?? [], count: v?.count ?? 0, uniqueBiz: v?.uniqueBizCount ?? 0 };
  }, [data, scope]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return view.stores;
    return view.stores.filter(
      (s) => s.storeName.toLowerCase().includes(kw) || s.bizNo.includes(kw)
    );
  }, [view, q]);

  const toolbarButtons = (
    <>
      <button className="check-btn" onClick={handleCheck} disabled={checking || syncing}>
        {checking ? "폐업조회 중…" : "🔎 폐업여부 조회"}
      </button>
      <button className="sync-btn" onClick={handleSync} disabled={syncing || checking}>
        {syncing ? "동기화 중…" : "↻ 지금 동기화"}
      </button>
    </>
  );

  if (error)
    return (
      <div className="sales">
        <div className="sales__toolbar">{toolbarButtons}</div>
        <div className="state state--error">불러오기 실패: {error}</div>
      </div>
    );
  if (!data) return <div className="state">무실적 가맹점을 불러오는 중…</div>;

  const empty = data.combinedCount === 0 && data.vans.length === 0;

  return (
    <div className="sales">
      <div className="sales__toolbar">
        {data.updatedAt && (
          <span className="sales__updated">
            수집 {new Date(data.updatedAt).toLocaleString("ko-KR")}
            {data.statusCheckedAt && ` · 폐업조회 ${new Date(data.statusCheckedAt).toLocaleString("ko-KR")}`}
          </span>
        )}
        {toolbarButtons}
      </div>

      {syncError && <div className="state state--error">동기화 실패: {syncError}</div>}
      {checkError && <div className="state state--error">폐업조회 실패: {checkError}</div>}
      {checking && <div className="state">국세청 사업자상태 조회 중… (건수 많으면 수십 초)</div>}
      {data.syncWarning && <div className="state state--error">일부 실패: {data.syncWarning}</div>}
      {syncing && <div className="state">로그인 → 조회 중… (다우데이타는 이메일 인증으로 수십 초 소요)</div>}
      {empty && !syncing && (
        <div className="state">아직 수집 전입니다. '지금 동기화' 또는 매일 08:00 자동 수집 후 표시됩니다.</div>
      )}

      {/* VAN 탭 */}
      <div className="van-tabs">
        <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>
          합산 ({data.combinedCount.toLocaleString("ko-KR")})
        </button>
        {data.vans.map((v) => (
          <button
            key={v.van}
            className={scope === v.van ? "is-active" : ""}
            onClick={() => setScope(v.van)}
          >
            {v.label} ({v.count.toLocaleString("ko-KR")})
          </button>
        ))}
      </div>

      <div className="sales__kpis">
        <section className="metric">
          <div className="metric__label">무실적 가맹점(매장) 수</div>
          <div className="metric__amount">{view.count.toLocaleString("ko-KR")}개</div>
          <div className="metric__hint">{scope === "all" ? "코밴 + 다우데이타 합산" : `${scope} 기준`}</div>
        </section>
        <section className="metric">
          <div className="metric__label">고유 사업자번호 수</div>
          <div className="metric__amount">{view.uniqueBiz.toLocaleString("ko-KR")}개</div>
          <div className="metric__hint">사업자 기준</div>
        </section>
        <section className="metric">
          <div className="metric__label">폐업 확인</div>
          <div className="metric__amount" style={{ color: (data.closedCount ?? 0) > 0 ? "#b91c1c" : undefined }}>
            {data.statusCheckedAt ? `${(data.closedCount ?? 0).toLocaleString("ko-KR")}개` : "-"}
          </div>
          <div className="metric__hint">
            {data.statusCheckedAt ? "합산 기준 (국세청)" : "‘폐업여부 조회’ 누르면 표시"}
          </div>
        </section>
      </div>

      <section className="card card--wide">
        <div className="table-head">
          <h2 className="card__title">무실적 가맹점 목록</h2>
          <input
            className="search"
            placeholder="매장명 · 사업자번호 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="table-meta">
          {q ? `검색 ${filtered.length}개 / ` : ""}전체 {view.count.toLocaleString("ko-KR")}개
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "5%" }}>#</th>
                <th style={{ width: "31%" }}>가맹점명(매장명)</th>
                <th style={{ width: "15%" }}>사업자번호</th>
                <th style={{ width: "9%", textAlign: "center" }}>VAN사</th>
                <th style={{ width: "13%", textAlign: "center" }}>사업자상태</th>
                <th style={{ width: "15%", textAlign: "right" }}>작년 매출</th>
                <th style={{ width: "12%", textAlign: "center" }}>연락처</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const st = statusLabel(s.status);
                return (
                  <tr key={`${s.van}-${s.bizNo}-${i}`}>
                    <td className="muted">{i + 1}</td>
                    <td>{s.storeName}</td>
                    <td>{s.bizNo}</td>
                    <td className="muted" style={{ textAlign: "center" }}>{s.van}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`status-badge status-badge--${st.tone}`}>{st.text}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {s.lastYearSales != null ? `${Math.round(s.lastYearSales).toLocaleString("ko-KR")}원` : <span className="muted">-</span>}
                    </td>
                    <td className="muted" style={{ textAlign: "center" }}>{s.phone || "-"}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    {view.count === 0 ? "수집된 데이터가 없습니다." : "검색 결과가 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
