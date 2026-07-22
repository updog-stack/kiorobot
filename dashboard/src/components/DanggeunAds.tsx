import { useEffect, useState } from "react";
import { fetchDaangnAds, type DaangnAds } from "../lib/daangn";

// 광고캐시·지출은 만원 축약 없이 원 단위(천원 이하까지)로 정확히 표시
const wonF = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

export function DanggeunAds() {
  const [d, setD] = useState<DaangnAds | null>(null);
  useEffect(() => {
    const load = () => fetchDaangnAds().then(setD).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="dga">
      <div className="dga__head">
        <h2>🥕 당근마켓 광고현황</h2>
        {d?.updatedAt && <span className="dga__upd">{ago(d.updatedAt)} 갱신 · {d.period}</span>}
      </div>

      {!d ? (
        <div className="dga__placeholder">불러오는 중…</div>
      ) : d.loggedOut || d.error ? (
        <div className="dga__placeholder">
          ⚠️ {d.error || "세션 만료 — 재로그인 필요"}
          <br />
          <span style={{ fontSize: 12 }}>당근 수집 데몬 창에서 다시 로그인해 주세요.</span>
        </div>
      ) : d.note ? (
        <div className="dga__placeholder">{d.note}</div>
      ) : (
        <>
          {/* 요약 */}
          <div className="dga__kpis">
            <div className="dga__kpi"><span>광고캐시</span><b>{wonF(d.cash ?? 0)}</b></div>
            <div className="dga__kpi"><span>노출수</span><b>{(d.total?.impressions ?? 0).toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>클릭수</span><b>{(d.total?.clicks ?? 0).toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>클릭률(CTR)</span><b>{(d.total?.ctr ?? 0).toFixed(2)}%</b></div>
            <div className="dga__kpi dga__kpi--spend"><span>지출</span><b>{wonF(d.total?.spend ?? 0)}</b></div>
          </div>

          {/* 광고별 */}
          <div className="dga__ads">
            {d.ads.map((a, i) => (
              <div className="dga__ad" key={i}>
                <div className="dga__ad-top">
                  <span className={`dga__badge dga__badge--${a.type === "검색" ? "search" : "display"}`}>{a.type}</span>
                  <span className="dga__ad-name">{a.name}</span>
                  <span className={`dga__status dga__status--${a.status === "ON" ? "on" : "off"}`}>{a.status}</span>
                </div>
                <div className="dga__ad-nums">
                  <div><span>노출</span><b>{a.impressions.toLocaleString("ko-KR")}</b></div>
                  <div><span>클릭</span><b>{a.clicks.toLocaleString("ko-KR")}</b></div>
                  <div><span>CTR</span><b>{a.ctr.toFixed(2)}%</b></div>
                  <div><span>지출</span><b>{wonF(a.spend)}</b></div>
                  <div><span>하루예산</span><b>{wonF(a.dailyBudget)}</b></div>
                </div>
                {/* 그룹 안의 개별 광고(소재) — 목록 페이지엔 클릭률만 제공됨 */}
                {!!a.creatives?.length && (
                  <ul className="dga__creatives">
                    {a.creatives.map((c, j) => (
                      <li className="dga__creative" key={j}>
                        <span className={`dga__dot dga__dot--${c.status === "ON" ? "on" : "off"}`} />
                        <span className="dga__creative-name">{c.name}</span>
                        <span className="dga__creative-ctr">{c.ctr === null ? "—" : `${c.ctr.toFixed(2)}%`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="dga__foot">상주 수집(30분 주기) · 로그인 세션 유지 필요</p>
        </>
      )}
    </div>
  );
}
