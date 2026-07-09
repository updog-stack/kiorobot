import { useEffect, useState } from "react";
import { fetchYoutube, type YoutubeStats } from "../lib/youtube";

const n = (x: number) => x.toLocaleString("ko-KR");

// 유튜브 로고 아이콘
function YtIcon() {
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden style={{ flexShrink: 0 }}>
      <rect width="28" height="20" rx="5" fill="#FF0000" />
      <path d="M11 6 L20 10 L11 14 Z" fill="#fff" />
    </svg>
  );
}

export function YoutubeCard() {
  const [data, setData] = useState<YoutubeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchYoutube()
      .then(setData)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);

  return (
    <section className="card card--wide yt-card">
      {/* 제목 + 채널 열기 (제목 옆) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <YtIcon />
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1.1 }}>
          유튜브{data ? ` — ${data.channelTitle}` : ""}
        </h2>
        {data && (
          <a
            href={data.url}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--brand)",
              textDecoration: "none",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "6px 12px",
            }}
          >
            채널 열기 ↗
          </a>
        )}
      </div>

      {error && <div className="state state--error">{error}</div>}
      {!data && !error && <div className="state">불러오는 중…</div>}

      {data && (
        <>
          <div className="sales__kpis">
            <div className="metric">
              <div className="metric__label">구독자</div>
              <div className="metric__amount">{n(data.subscribers)}명</div>
            </div>
            <div className="metric">
              <div className="metric__label">총 조회수</div>
              <div className="metric__amount">{n(data.totalViews)}</div>
            </div>
            <div className="metric">
              <div className="metric__label">영상 수</div>
              <div className="metric__amount">{n(data.videoCount)}개</div>
            </div>
          </div>

          {data.recentVideos.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>최근 영상</h3>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                {data.recentVideos.slice(0, 3).map((v) => (
                  <li key={v.id}>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none", color: "var(--text)", display: "block" }}
                    >
                      {v.thumb && (
                        <img
                          src={v.thumb}
                          alt=""
                          style={{
                            width: "100%",
                            aspectRatio: "16 / 9",
                            objectFit: "cover",
                            borderRadius: 10,
                            display: "block",
                          }}
                        />
                      )}
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          marginTop: 8,
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {v.title}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        조회 {n(v.views)}
                        {v.publishedAt ? ` · ${v.publishedAt.slice(0, 10)}` : ""}
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
            10분마다 갱신 · {new Date(data.updatedAt).toLocaleString("ko-KR")} 기준
          </p>
        </>
      )}
    </section>
  );
}
