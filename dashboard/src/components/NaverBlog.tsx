import { useEffect, useState } from "react";
import { fetchNaverBlog, type NaverBlog as NB } from "../lib/naverBlog";

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
}

// 좌측 눈금용: 데이터 최댓값 → 4구간 라운드 스케일
function niceScale(dataMax: number, ticks = 4): { max: number; step: number } {
  const rough = Math.max(1, dataMax) / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = (n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 5 ? 5 : 10) * pow;
  return { max: step * ticks, step };
}

export function NaverBlog() {
  const [d, setD] = useState<NB | null>(null);
  useEffect(() => {
    const load = () => fetchNaverBlog().then(setD).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  // 최근 14일(오래된→최신)
  const g = d?.views
    ? d.views.values.slice(0, 14).map((v, i) => ({ v, date: d.views!.dates[i] })).reverse()
    : [];
  const dataMax = Math.max(1, ...g.map((x) => x.v));
  const { max: axisMax, step } = niceScale(dataMax, 4);
  const ticks = Array.from({ length: 5 }, (_, i) => step * i);

  return (
    <div className="dga">
      <div className="dga__head">
        <h2>📝 다인아이앤씨 블로그</h2>
        {d?.updatedAt && !d.error && !d.note && <span className="dga__upd">{ago(d.updatedAt)} 갱신 · 조회수</span>}
      </div>

      {!d ? (
        <div className="dga__placeholder">불러오는 중…</div>
      ) : d.loggedOut || d.error ? (
        <div className="dga__placeholder">
          ⚠️ {d.error || "세션 만료 — 재로그인 필요"}
          <br />
          <span style={{ fontSize: 12 }}>naver-blog-login.bat 실행해 재로그인 후 다시 수집됩니다.</span>
        </div>
      ) : d.note ? (
        <div className="dga__placeholder">{d.note}</div>
      ) : (
        <>
          <div className="dga__kpis">
            <div className="dga__kpi"><span>오늘 조회</span><b>{d.today.toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>어제</span><b>{d.yesterday.toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>최근 7일</span><b>{d.last7.toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>최근 30일</span><b>{d.last30.toLocaleString("ko-KR")}</b></div>
          </div>
          <div className="bchart">
            {/* 좌측 수치 눈금 */}
            <div className="bchart__y">
              {ticks.slice().reverse().map((t) => (
                <span className="bchart__ytick" key={t}>{t.toLocaleString("ko-KR")}</span>
              ))}
            </div>
            <div className="bchart__body">
              <div className="bchart__plot">
                {ticks.map((t) => (
                  <div className="bchart__grid" key={t} style={{ bottom: `${(t / axisMax) * 100}%` }} />
                ))}
                <div className="bchart__bars">
                  {g.map((x, i) => (
                    <div className="bchart__col" key={i} title={`${x.date}: ${x.v.toLocaleString("ko-KR")}회`}>
                      <div className="bchart__bar" style={{ height: `${(x.v / axisMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="bchart__x">
                {g.map((x, i) => (
                  <span className="bchart__xtick" key={i}>{x.date?.slice(5).replace("-", "/")}</span>
                ))}
              </div>
            </div>
          </div>
          <p className="dga__foot">최근 14일 일별 조회수 · 세션 재사용 수집(창 뜸)</p>
        </>
      )}
    </div>
  );
}
