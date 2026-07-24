import { useEffect, useMemo, useState } from "react";
import { fetchInventory, fmtQty, type InventoryData } from "../lib/inventory";

// 재고현황 — 이카운트(ECount) 창고별 품목 현재고. 수집/동기화는 헤더 '데이터 동기화'(scope=inventory)가 담당.
export function Inventory() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState("all"); // "all" | 창고코드
  const [q, setQ] = useState("");
  const [hideZero, setHideZero] = useState(true); // 재고 0 품목 숨기기

  useEffect(() => {
    let alive = true;
    fetchInventory()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const warehouses = data?.warehouses ?? [];

  const filtered = useMemo(() => {
    if (!data) return [];
    const kw = q.trim().toLowerCase();
    return data.items.filter((it) => {
      if (scope !== "all" && !((it.byWh[scope] ?? 0) > 0)) return false;
      if (hideZero && scope === "all" && !(it.total > 0)) return false;
      if (kw && !(`${it.prodCd} ${it.prodDes} ${it.size}`.toLowerCase().includes(kw))) return false;
      return true;
    });
  }, [data, scope, q, hideZero]);

  if (error)
    return <div className="sales"><div className="state state--error">불러오기 실패: {error}</div></div>;
  if (!data) return <div className="state">재고현황을 불러오는 중…</div>;

  const empty = (data.items?.length ?? 0) === 0;
  // scope별 표시용 총합(품목수 = filtered, 수량합 = 해당 스코프 컬럼 기준)
  const shownQty = filtered.reduce((s, it) => s + (scope === "all" ? it.total : (it.byWh[scope] ?? 0)), 0);

  return (
    <div className="sales">
      <div className="sales__toolbar">
        {data.updatedAt && (
          <span className="sales__updated">
            수집 {new Date(data.updatedAt).toLocaleString("ko-KR")}
            {data.baseDate && ` · 기준일 ${data.baseDate.slice(0, 4)}-${data.baseDate.slice(4, 6)}-${data.baseDate.slice(6, 8)}`}
          </span>
        )}
      </div>

      {data.syncWarning && <div className="state state--error">일부 실패: {data.syncWarning}</div>}
      {empty && (
        <div className="state">아직 수집 전입니다. 헤더의 '🔄 데이터 동기화' 또는 매일 08:00 자동 수집 후 표시됩니다.</div>
      )}

      {/* KPI: 품목 수 + 총재고 + 창고별 */}
      <div className="sales__kpis">
        <section className="metric">
          <div className="metric__label">총 품목 수</div>
          <div className="metric__amount">{data.itemCount.toLocaleString("ko-KR")}개</div>
          <div className="metric__hint">이카운트 등록 품목</div>
        </section>
        <section className="metric">
          <div className="metric__label">총 재고수량</div>
          <div className="metric__amount">{fmtQty(data.totalQty)}</div>
          <div className="metric__hint">전 창고 합계</div>
        </section>
        {warehouses.map((w) => (
          <section className="metric" key={w.code}>
            <div className="metric__label">{w.name}</div>
            <div className="metric__amount">{fmtQty(data.byWhTotal?.[w.code] ?? 0)}</div>
            <div className="metric__hint">창고코드 {w.code}</div>
          </section>
        ))}
      </div>

      {/* 창고 필터 탭 */}
      <div className="van-tabs">
        <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>
          전체 ({data.itemCount.toLocaleString("ko-KR")})
        </button>
        {warehouses.map((w) => {
          const cnt = data.items.filter((it) => (it.byWh[w.code] ?? 0) > 0).length;
          return (
            <button key={w.code} className={scope === w.code ? "is-active" : ""} onClick={() => setScope(w.code)}>
              {w.name} ({cnt.toLocaleString("ko-KR")})
            </button>
          );
        })}
      </div>

      <section className="card card--wide">
        <div className="table-head">
          <h2 className="card__title">재고 목록{scope !== "all" ? ` · ${warehouses.find((w) => w.code === scope)?.name}` : ""}</h2>
          <input
            className="search"
            placeholder="품목코드 · 품목명 · 규격 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="table-meta">
          {q ? `검색 ${filtered.length}개 / ` : ""}표시 {filtered.length.toLocaleString("ko-KR")}개 · 수량합 {fmtQty(shownQty)}
          {scope === "all" && (
            <label style={{ marginLeft: 12, fontWeight: 400, cursor: "pointer" }}>
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> 재고 0 숨기기
            </label>
          )}
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "3%" }}>#</th>
                <th style={{ width: "22%" }}>품목코드</th>
                <th style={{ width: "22%" }}>품목명</th>
                <th style={{ width: "12%" }}>규격</th>
                <th style={{ width: "10%", textAlign: "right" }}>총재고</th>
                {warehouses.map((w) => (
                  <th key={w.code} style={{ width: "11%", textAlign: "right" }}>{w.name}</th>
                ))}
                <th aria-hidden style={{ width: "7%" }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, i) => (
                <tr key={`${it.prodCd}-${i}`}>
                  <td className="muted">{i + 1}</td>
                  <td>{it.prodCd}</td>
                  <td>{it.prodDes || <span className="muted">-</span>}</td>
                  <td className="muted">{it.size || "-"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtQty(it.total)}</td>
                  {warehouses.map((w) => {
                    const v = it.byWh[w.code] ?? 0;
                    return (
                      <td key={w.code} style={{ textAlign: "right", color: v === 0 ? "#9ca3af" : undefined }}>
                        {fmtQty(v)}
                      </td>
                    );
                  })}
                  <td aria-hidden />
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6 + warehouses.length} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    {empty ? "수집된 데이터가 없습니다." : "검색 결과가 없습니다."}
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
