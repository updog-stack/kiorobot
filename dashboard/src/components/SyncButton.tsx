import { useEffect, useRef, useState } from "react";
import { startCollect, getCollectStatus } from "../lib/collect";

// 전체 데이터 동기화 버튼(코밴·다우데이타 수집 + 최신화). 진행 중엔 상태 폴링.
export function SyncButton() {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  function stopPoll() {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
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
      await startCollect();
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
      title="코밴·다우데이타 거래·무실적 수집 + 최신화 (수 분 소요)"
    >
      {running ? "동기화 중… (수 분)" : "🔄 데이터 동기화"}
      {msg && !running ? ` · ${msg}` : ""}
    </button>
  );
}
