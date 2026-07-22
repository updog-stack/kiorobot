import { useEffect, useState } from "react";
import { fetchNaverBlog, toBlogList, type BlogStat, type NaverBlogPayload } from "../lib/naverBlog";

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

// 블로그마다 로그인 세션이 달라 재로그인 안내도 블로그별로 달라진다.
function loginHint(index: number): string {
  return index === 0
    ? "네이버블로그로그인.bat 실행해 재로그인 후 다시 수집됩니다."
    : `node server/naver-blog-login.mjs ${index + 1} 실행해 재로그인 후 다시 수집됩니다.`;
}

function BlogCard({ blog, updatedAt, index }: { blog: BlogStat; updatedAt: string | null; index: number }) {
  // 최근 14일(오래된→최신)
  const g = blog.views
    ? blog.views.values.slice(0, 14).map((v, i) => ({ v, date: blog.views!.dates[i] })).reverse()
    : [];
  const dataMax = Math.max(1, ...g.map((x) => x.v));
  const { max: axisMax, step } = niceScale(dataMax, 4);
  const ticks = Array.from({ length: 5 }, (_, i) => step * i);
  const broken = blog.loggedOut || blog.error;

  return (
    <div className="dga">
      <div className="dga__head">
        <h2>📝 {blog.label}</h2>
        {updatedAt && !broken && <span className="dga__upd">{ago(updatedAt)} 갱신 · 조회수</span>}
      </div>

      {broken ? (
        <div className="dga__placeholder">
          ⚠️ {blog.error || "세션 만료 — 재로그인 필요"}
          <br />
          <span style={{ fontSize: 12 }}>{loginHint(index)}</span>
        </div>
      ) : (
        <>
          <div className="dga__kpis">
            <div className="dga__kpi"><span>오늘 조회</span><b>{blog.today.toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>어제</span><b>{blog.yesterday.toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>최근 7일</span><b>{blog.last7.toLocaleString("ko-KR")}</b></div>
            <div className="dga__kpi"><span>최근 30일</span><b>{blog.last30.toLocaleString("ko-KR")}</b></div>
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

export function NaverBlog() {
  const [payload, setPayload] = useState<NaverBlogPayload | null>(null);
  useEffect(() => {
    const load = () => fetchNaverBlog().then(setPayload).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  if (!payload) {
    return (
      <div className="dga">
        <div className="dga__head"><h2>📝 블로그</h2></div>
        <div className="dga__placeholder">불러오는 중…</div>
      </div>
    );
  }

  const blogs = toBlogList(payload);
  if (!blogs.length) {
    return (
      <div className="dga">
        <div className="dga__head"><h2>📝 블로그</h2></div>
        <div className="dga__placeholder">{payload.note || payload.error || "블로그 통계 미수집"}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {blogs.map((b, i) => (
        <BlogCard key={b.blogId ?? b.label ?? i} blog={b} updatedAt={payload.updatedAt} index={i} />
      ))}
    </div>
  );
}
