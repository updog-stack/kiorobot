import { useState } from "react";
import { TaskStatusView } from "./TaskStatus";
import { CsStatus } from "./CsStatus";
import { CallHeatmap } from "./CallHeatmap";
import { WorkLog } from "./WorkLog";
import { ResponsibilityView } from "./Responsibility";

type Tab = "tasks" | "cs" | "worklog" | "responsibility";

// 업무현황(대표) + CS현황 + 업무일지를 한 메뉴에서 탭으로 전환
export function WorkHub() {
  const [tab, setTab] = useState<Tab>("tasks");
  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="seg">
        <button className={tab === "tasks" ? "is-active" : ""} onClick={() => setTab("tasks")}>
          ✅ 업무현황
        </button>
        <button className={tab === "cs" ? "is-active" : ""} onClick={() => setTab("cs")}>
          💬 CS 현황
        </button>
        <button className={tab === "worklog" ? "is-active" : ""} onClick={() => setTab("worklog")}>
          📝 업무일지
        </button>
        <button className={tab === "responsibility" ? "is-active" : ""} onClick={() => setTab("responsibility")}>
          🧭 담당업무
        </button>
      </div>

      {tab === "tasks" && <TaskStatusView />}

      {tab === "cs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <CsStatus />
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "4px 0 4px" }}>인입 현황 (전화·채팅)</h2>
            <CallHeatmap />
          </div>
        </div>
      )}

      {tab === "worklog" && <WorkLog />}

      {tab === "responsibility" && <ResponsibilityView />}
    </div>
  );
}
