import { useEffect, useState } from "react";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { Header, type Role } from "./components/Header";
import { Login } from "./components/Login";
import { getSession, logout } from "./lib/auth";
import { WorkHub } from "./components/WorkHub";
import { Overview } from "./components/Overview";
import { Schedule } from "./components/Schedule";
import { ManagementMetrics } from "./components/ManagementMetrics";
import { AiSupport } from "./components/AiSupport";
import { TrMetrics } from "./components/TrMetrics";
import { InactiveStores } from "./components/InactiveStores";
import { Marketing } from "./components/Marketing";
import { SalesStatus } from "./components/SalesStatus";
import "./App.css";

const NAV: NavItem[] = [
  { key: "overview", label: "전체 현황", icon: "📊" },
  { key: "sales", label: "매출현황", icon: "💰" },
  { key: "tr", label: "거래(TR) 현황", icon: "💳" },
  { key: "metrics", label: "경영 지표", icon: "📈" },
  { key: "schedule", label: "일정", icon: "📅" },
  { key: "work", label: "업무현황", icon: "✅" },
  { key: "marketing", label: "마케팅 현황", icon: "📣" },
  { key: "aisupport", label: "AI 업무지원", icon: "🪄" },
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
  // 데이터 동기화 완료 시 증가 → 현재 보고 있는 화면을 remount해 최신 데이터 재조회
  const [syncNonce, setSyncNonce] = useState(0);
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
          onSynced={() => setSyncNonce((n) => n + 1)}
          syncScope={active}
        />

        <main className="content" key={syncNonce}>
          {active === "overview" && (
            <div className="full">
              <Overview />
            </div>
          )}

          {active === "sales" && (
            <div className="full">
              <SalesStatus />
            </div>
          )}

          {active === "aisupport" && <AiSupport />}

          {active === "marketing" && <Marketing />}

          {active === "schedule" && (
            <div className="full">
              <Schedule />
            </div>
          )}

          {active === "work" && <WorkHub />}

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
