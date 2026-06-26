import { useState } from "react";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { Header, type Role } from "./components/Header";
import { Card } from "./components/Card";
import { Overview } from "./components/Overview";
import { Schedule } from "./components/Schedule";
import { ManagementMetrics } from "./components/ManagementMetrics";
import { TrMetrics } from "./components/TrMetrics";
import { InactiveStores } from "./components/InactiveStores";
import { CsStatus } from "./components/CsStatus";
import { CallHeatmap } from "./components/CallHeatmap";
import { Playbooks } from "./components/Playbooks";
import "./App.css";

const NAV: NavItem[] = [
  { key: "overview", label: "전체 현황", icon: "📊" },
  { key: "cs", label: "CS 현황", icon: "💬" },
  { key: "playbooks", label: "꿀팁게시판", icon: "💡" },
  { key: "schedule", label: "일정", icon: "📅" },
  { key: "tasks", label: "업무 / 할 일", icon: "✅" },
  { key: "metrics", label: "경영 지표", icon: "📈" },
  { key: "tr", label: "거래(TR) 현황", icon: "💳" },
  { key: "inactive", label: "무실적 가맹점", icon: "🏪" },
];

// 역할별로 강조되는 화면 (master.md §6.1)
const ROLE_SUBTITLE: Record<Role, string> = {
  ceo: "경영 지표 중심 뷰",
  lead: "전체 현황 뷰",
  staff: "내 업무 중심 뷰",
};

function App() {
  const [active, setActive] = useState("overview");
  const [role, setRole] = useState<Role>("lead");

  const current = NAV.find((n) => n.key === active)!;

  return (
    <div className="app">
      <Sidebar items={NAV} active={active} onSelect={setActive} />

      <div className="main">
        <Header
          title={current.label}
          subtitle={ROLE_SUBTITLE[role]}
          role={role}
          onRoleChange={setRole}
        />

        <main className="content">
          {active === "overview" && (
            <div className="full">
              <Overview />
            </div>
          )}

          {active === "cs" && (
            <div className="full" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <CsStatus />
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: "4px 0 4px" }}>인입 현황 (전화·채팅)</h2>
                <CallHeatmap />
              </div>
            </div>
          )}

          {active === "playbooks" && (
            <div className="full">
              <Playbooks />
            </div>
          )}

          {active === "schedule" && (
            <div className="full">
              <Schedule />
            </div>
          )}

          {active === "tasks" && (
            <Card
              title="업무 / 할 일"
              description="노션 업무 DB. 프로젝트별 진행 상태(todo · doing · done)."
              wide
            />
          )}

          {active === "metrics" && (
            <div className="full">
              <ManagementMetrics />
            </div>
          )}

          {active === "tr" && (
            <div className="full">
              <TrMetrics />
            </div>
          )}

          {active === "inactive" && (
            <div className="full">
              <InactiveStores />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
