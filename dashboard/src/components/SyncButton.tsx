import { useEffect, useRef, useState } from "react";
import { startCollect, getCollectStatus } from "../lib/collect";

// 데이터 동기화 버튼 — 현재 보고 있는 페이지(scope)에 필요한 데이터만 수집·최신화.
//   완료되면 onSynced() 호출 → 현재 화면을 최신 데이터로 재조회. 진행 중엔 상태 폴링.
export function SyncButton({ scope, onSynced }: { scope?: string; onSynced?: () => void }) {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  function stopPoll() {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }

  // 마케팅 데이터(당근·네이버)의 updatedAt 지문
  async function marketingStamp(): Promise<string> {
    try {
      const [d, n] = await Promise.all([
        fetch("/api/daangn-ads").then((x) => x.json()).catch(() => ({})),
        fetch("/api/naver-blog").then((x) => x.json()).catch(() => ({})),
      ]);
      return `${d?.updatedAt ?? ""}|${n?.updatedAt ?? ""}`;
    } catch {
      return "";
    }
  }

  // 마케팅 수집(비동기)이 반영되면 자동으로 현재 화면 새로고침. 최대 ~3분 감시.
  async function watchMarketing() {
    stopPoll();
    const base = await marketingStamp();
    let tries = 0;
    timer.current = window.setInterval(async () => {
      tries += 1;
      const now = await marketingStamp();
      if (now && now !== base) {
        stopPoll();
        setMsg("수집 완료 · 갱신됨");
        onSynced?.(); // 현재 페이지 remount → 최신 데이터 표시
      } else if (tries >= 18) {
        stopPoll(); // ~3분 경과(변화 없음): PC 꺼짐/세션만료 등
      }
    }, 10000);
  }

  function poll() {
    stopPoll();
    timer.current = window.setInterval(async () => {
      try {
        const s = await getCollectStatus();
        if (!s.running) {
          stopPoll();
          setRunning(false);
          if (s.finishedAt) {
            const t = new Date(s.finishedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
            setMsg(s.errors?.length ? `일부 실패 ${s.errors.length}건` : `완료 ${t}`);
          }
          onSynced?.(); // 수집 완료 → 현재 화면 재조회
        }
      } catch {
        /* 무시하고 다음 폴링 */
      }
    }, 5000);
  }

  useEffect(() => {
    getCollectStatus()
      .then((s) => {
        if (s.running) {
          setRunning(true);
          poll();
        }
      })
      .catch(() => {});
    return stopPoll;
  }, []);

  async function onClick() {
    if (running) return;
    setRunning(true);
    setMsg(null);
    try {
      const r = await startCollect(scope);
      // 마케팅: 로컬/원격에서 비동기 수집 → 데이터 갱신을 감지하면 자동으로 현재 화면 새로고침
      if (r.marketing) {
        setRunning(false);
        setMsg(r.note ?? (r.started ? "백그라운드 수집 중 · 곧 자동 갱신" : "로컬에서만 가능"));
        if (r.started) watchMarketing();
        return;
      }
      poll();
    } catch (e) {
      setRunning(false);
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <button
      className="logout-btn"
      onClick={onClick}
      disabled={running}
      title="지금 보고 있는 화면의 데이터만 수집·최신화 (전체 자동 수집은 매일 08:00)"
    >
      {running ? "동기화 중… (수 분)" : "🔄 데이터 동기화"}
      {msg && !running ? ` · ${msg}` : ""}
    </button>
  );
}
