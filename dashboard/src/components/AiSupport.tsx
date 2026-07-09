import { useState } from "react";
import { Knowledge } from "./Knowledge";
import { BlogChecker } from "./BlogChecker";
import { PromptGen } from "./PromptGen";

type Tab = "playbooks" | "blog" | "promptgen";

// AI 업무지원 — 꿀팁게시판 + 블로그 검사기 + 프롬프트 생성기를 한 메뉴에서 탭 전환
export function AiSupport() {
  const [tab, setTab] = useState<Tab>("playbooks");
  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="seg">
        <button className={tab === "playbooks" ? "is-active" : ""} onClick={() => setTab("playbooks")}>
          💡 꿀팁게시판
        </button>
        <button className={tab === "blog" ? "is-active" : ""} onClick={() => setTab("blog")}>
          📝 블로그 검사기
        </button>
        <button className={tab === "promptgen" ? "is-active" : ""} onClick={() => setTab("promptgen")}>
          🪄 프롬프트 생성기
        </button>
      </div>

      {tab === "playbooks" && <Knowledge />}
      {tab === "blog" && (
        <div className="full">
          <BlogChecker />
        </div>
      )}
      {tab === "promptgen" && (
        <div className="full">
          <PromptGen />
        </div>
      )}
    </div>
  );
}
