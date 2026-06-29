import { useEffect, useState } from "react";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { Header, type Role } from "./components/Header";
import { Login } from "./components/Login";
import { getSession, logout } from "./lib/auth";
import { TaskStatusView } from "./components/TaskStatus";
import { WorkLog } from "./components/WorkLog";
import { Overview } from "./components/Overview";
import { Schedule } from "./components/Schedule";
import { ManagementMetrics } from "./components/ManagementMetrics";
import { BlogChecker } from "./components/BlogChecker";
import { TrMetrics } from "./components/TrMetrics";
import { InactiveStores } from "./components/InactiveStores";
import { CsStatus } from "./components/CsStatus";
import { CallHeatmap } from "./components/CallHeatmap";
import { Knowledge } from "./components/Knowledge";
import "./App.css";

const NAV: NavItem[] = [
  { key: "overview", label: "전체 현황", icon: "📊" },
  { key: "cs", label: "CS 현황", icon: "💬" },
  { key: "blog", label: "블로그 검사기", icon: "📝" },
  { key: "playbooks", label: "꿀팁게시판", icon: "💡" },
  { key: "schedule", label: "일정", icon: "📅" },
  { key: "tasks", label: "업무현황", icon: "✅" },
  { key: "worklog", label: "업무일지", icon: "📝" },
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
  // "checking" → 세션 확인 중, "in" → 접속 허용, "out" → 로그인 필요
  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking");

  useEffect(() => {
    getSession()
      .then((s) => setAuthState(!s.authRequired || s.authed ? "in" : "out"))
      .catch(() => setAuthState("out"));
  }, []);

  const current = NAV.find((n) => n.key === active)!;

  if (authState === "checking") {
    return <div className="auth-loading">확인 중…</div>;
  }
  if (authState === "out") {
    return <Login onSuccess={() => setAuthState("in")} />;
  }

  async function handleLogout() {
    await logout();
    setAuthState("out");
  }

  return (
    <div className="app">
      <Sidebar items={NAV} active={active} onSelect={setActive} />

      <div className="main">
        <Header
          title={current.label}
          subtitle={ROLE_SUBTITLE[role]}
          role={role}
          onRoleChange={setRole}
          onLogout={handleLogout}
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

          {active === "blog" && (
            <div className="full">
              <BlogChecker />
            </div>
          )}

          {active === "playbooks" && <Knowledge />}

          {active === "schedule" && (
            <div className="full">
              <Schedule />
            </div>
          )}

          {active === "tasks" && (
            <div className="full">
              <TaskStatusView />
            </div>
          )}

          {active === "worklog" && (
            <div className="full">
              <WorkLog />
            </div>
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
