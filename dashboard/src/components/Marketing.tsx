import { useState } from "react";
import { DanggeunAds } from "./DanggeunAds";
import { DanggeunCash } from "./DanggeunCash";
import { YoutubeCard } from "./YoutubeCard";
import { NaverBlog } from "./NaverBlog";

type Tab = "all" | "danggeun" | "cash" | "youtube" | "blog";

export function Marketing() {
  const [tab, setTab] = useState<Tab>("all");
  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="seg">
        <button className={tab === "all" ? "is-active" : ""} onClick={() => setTab("all")}>
          🗂️ 전체보기
        </button>
        <button className={tab === "danggeun" ? "is-active" : ""} onClick={() => setTab("danggeun")}>
          🥕 당근마켓 광고
        </button>
        <button className={tab === "cash" ? "is-active" : ""} onClick={() => setTab("cash")}>
          💳 당근 캐시
        </button>
        <button className={tab === "youtube" ? "is-active" : ""} onClick={() => setTab("youtube")}>
          📺 유튜브
        </button>
        <button className={tab === "blog" ? "is-active" : ""} onClick={() => setTab("blog")}>
          📝 블로그
        </button>
      </div>

      {tab === "all" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <DanggeunAds />
          <DanggeunCash />
          <NaverBlog />
          <YoutubeCard />
        </div>
      )}
      {tab === "danggeun" && <DanggeunAds />}
      {tab === "cash" && <DanggeunCash />}
      {tab === "youtube" && <YoutubeCard />}
      {tab === "blog" && <NaverBlog />}
    </div>
  );
}
