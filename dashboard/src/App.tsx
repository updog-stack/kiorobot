import { useState } from "react";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { Header, type Role } from "./components/Header";
import { Card } from "./components/Card";
import { SalesMetrics } from "./components/SalesMetrics";
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
            <>
              <Card title="CS 현황" description="미처리 문의 · 평균 응답 시간" />
              <Card title="오늘의 일정" description="미팅 · 마감 · 업무" />
              <Card title="진행 중 업무" description="프로젝트 · 태스크 진행 상태" />
              <Card
                title="경영 지표 추이"
                description="기간별 매출 · 비용 · KPI"
                wide
              />
            </>
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
            <Card
              title="일정"
              description="구글캘린더 → 노션 일정 DB. 미팅 · 마감 · 업무 일정."
              wide
            />
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
              <SalesMetrics />
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
