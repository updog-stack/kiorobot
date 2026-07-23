import { useEffect, useMemo, useState } from "react";
import { fetchDaangnCash, byMonth, byWeek, type DaangnCash, type CashTx } from "../lib/daangnCash";

// 캐시 금액은 만원 축약 없이 원 단위로 정확히 표시.
const wonF = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
// 부호를 붙인 금액(+충전 / -사용).
const signedF = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}원`;

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

// 거래일자 "2026-07-23" → "07.23"
const dateF = (d: string | null) => (d ? d.slice(5).replace("-", ".") : "—");

function netClass(n: number) {
  return n > 0 ? "dgc__pos" : n < 0 ? "dgc__neg" : "";
}

// 전체 거래내역 기간 필터 — 최근 1일/1주/1개월/1년.
type Range = "day" | "week" | "month" | "year";
const RANGES: Range[] = ["day", "week", "month", "year"];
const RANGE_LABEL: Record<Range, string> = { day: "일", week: "주", month: "월", year: "년" };

// 선택 기간의 시작일(YYYY-MM-DD, 오늘 기준). 거래 date 와 문자열 비교로 필터.
function cutoffYMD(range: Range): string {
  const d = new Date();
  if (range === "day") d.setDate(d.getDate() - 1);
  else if (range === "week") d.setDate(d.getDate() - 7);
  else if (range === "month") d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function DanggeunCash() {
  const [d, setD] = useState<DaangnCash | null>(null);
  useEffect(() => {
    const load = () => fetchDaangnCash().then(setD).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const txs = useMemo(() => d?.transactions ?? [], [d]);
  const months = useMemo(() => byMonth(txs), [txs]);
  const weeks = useMemo(() => byWeek(txs), [txs]);

  // 전체 거래내역: 기본 최근 1주일. 일/주/월/년 필터.
  const [range, setRange] = useState<Range>("week");
  const filteredTxs = useMemo(() => {
    const cut = cutoffYMD(range);
    return txs.filter((t) => t.date && t.date >= cut);
  }, [txs, range]);

  return (
    <div className="dga">
      <div className="dga__head">
        <h2>🥕 당근마켓 캐시 사용 내역</h2>
        {d?.updatedAt && <span className="dga__upd">{ago(d.updatedAt)} 갱신</span>}
      </div>

      {!d ? (
        <div className="dga__placeholder">불러오는 중…</div>
      ) : d.loggedOut || d.error ? (
        <div className="dga__placeholder">
          ⚠️ {d.error || "세션 만료 — 재로그인 필요"}
          <br />
          <span style={{ fontSize: 12 }}>로컬 PC에서 세션갱신.bat 을 실행해 세션을 다시 올려주세요.</span>
          {txs.length > 0 && <div style={{ fontSize: 12, marginTop: 8 }}>(아래는 마지막으로 수집된 내역입니다)</div>}
        </div>
      ) : txs.length === 0 ? (
        <div className="dga__placeholder">{d.note || "수집된 캐시 내역이 없습니다."}</div>
      ) : null}

      {txs.length > 0 && (
        <>
          {/* 잔액 */}
          {d?.balance && (
            <div className="dga__kpis">
              <div className="dga__kpi"><span>총 캐시</span><b>{wonF(d.balance.total)}</b></div>
              <div className="dga__kpi"><span>유상 캐시</span><b>{wonF(d.balance.paid)}</b></div>
              <div className="dga__kpi"><span>무상 캐시</span><b>{wonF(d.balance.free)}</b></div>
            </div>
          )}

          {/* 월별 요약 */}
          <div className="dgc__section">
            <h3 className="dgc__title">📅 월별 총액</h3>
            <div className="dgc__scroll">
              <table className="dgc__table">
                <thead>
                  <tr><th>월</th><th className="dgc__num">사용</th><th className="dgc__num">충전</th><th className="dgc__num">순증감</th><th className="dgc__num">건수</th></tr>
                </thead>
                <tbody>
                  {months.map((b) => (
                    <tr key={b.key}>
                      <td>{b.label}</td>
                      <td className="dgc__num dgc__neg">{b.usage ? `-${wonF(b.usage)}` : "—"}</td>
                      <td className="dgc__num dgc__pos">{b.charge ? `+${wonF(b.charge)}` : "—"}</td>
                      <td className={`dgc__num dgc__strong ${netClass(b.net)}`}>{signedF(b.net)}</td>
                      <td className="dgc__num dgc__muted">{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 주별 요약 */}
          <div className="dgc__section">
            <h3 className="dgc__title">🗓️ 주별 총액 <span className="dgc__hint">(월~일)</span></h3>
            <div className="dgc__scroll">
              <table className="dgc__table">
                <thead>
                  <tr><th>기간</th><th className="dgc__num">사용</th><th className="dgc__num">충전</th><th className="dgc__num">순증감</th><th className="dgc__num">건수</th></tr>
                </thead>
                <tbody>
                  {weeks.map((b) => (
                    <tr key={b.key}>
                      <td>{b.label}</td>
                      <td className="dgc__num dgc__neg">{b.usage ? `-${wonF(b.usage)}` : "—"}</td>
                      <td className="dgc__num dgc__pos">{b.charge ? `+${wonF(b.charge)}` : "—"}</td>
                      <td className={`dgc__num dgc__strong ${netClass(b.net)}`}>{signedF(b.net)}</td>
                      <td className="dgc__num dgc__muted">{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 전체 거래내역 */}
          <div className="dgc__section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              <h3 className="dgc__title" style={{ margin: 0 }}>🧾 전체 거래내역 <span className="dgc__hint">({filteredTxs.length}건)</span></h3>
              <div className="seg" style={{ marginRight: 0 }}>
                {RANGES.map((r) => (
                  <button key={r} className={range === r ? "is-active" : ""} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>
                ))}
              </div>
            </div>
            <div className="dgc__scroll">
              <table className="dgc__table">
                <thead>
                  <tr><th>일자</th><th>유형</th><th>내용</th><th className="dgc__num">금액</th></tr>
                </thead>
                <tbody>
                  {filteredTxs.length === 0 ? (
                    <tr><td colSpan={4} className="dgc__muted" style={{ textAlign: "center", padding: "18px 12px" }}>해당 기간의 거래가 없습니다.</td></tr>
                  ) : (
                    filteredTxs.map((t: CashTx) => (
                      <tr key={t.id}>
                        <td className="dgc__muted">{dateF(t.date)}</td>
                        <td>{t.title}</td>
                        <td className="dgc__muted">{t.description}</td>
                        <td className={`dgc__num dgc__strong ${netClass(t.signed)}`}>{signedF(t.signed)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="dga__foot">당근 광고 수집 시 함께 갱신 · 과거 내역은 누적 보존</p>
        </>
      )}
    </div>
  );
}
