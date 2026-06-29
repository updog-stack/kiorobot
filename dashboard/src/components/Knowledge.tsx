import { useState } from "react";
import { CsSearch } from "./CsSearch";
import { Playbooks } from "./Playbooks";

type Tab = "search" | "playbooks";

export function Knowledge() {
  const [tab, setTab] = useState<Tab>("search");

  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="seg">
        <button
          className={tab === "search" ? "is-active" : ""}
          onClick={() => setTab("search")}
        >
          🔍 상담 검색
        </button>
        <button
          className={tab === "playbooks" ? "is-active" : ""}
          onClick={() => setTab("playbooks")}
        >
          💡 플레이북(가이드)
        </button>
      </div>

      {tab === "search" ? <CsSearch /> : <Playbooks />}
    </div>
  );
}
