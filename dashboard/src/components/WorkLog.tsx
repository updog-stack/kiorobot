import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  fetchWorklog,
  generateWorklog,
  saveWorklogNote,
  fetchMonthlyWorklog,
  getCsReport,
  worklogPdfUrl,
  sendWorklogSlack,
  todayIso,
  type CsReport,
  type WorklogAssignee,
  type WorklogReport,
  type WorklogTaskLite,
  type MonthlyDigest,
  type DigestStory,
} from "../lib/worklog";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function WorkLog() {
  const [mode, setMode] = useState<"daily" | "monthly">("daily");

  // ----- 일간 -----
  const [dates, setDates] = useState<string[]>([]);
  const [report, setReport] = useState<WorklogReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [calYm, setCalYm] = useState<string>(() => todayIso().slice(0, 7));

  // ----- 월간 -----
  const [months, setMonths] = useState<string[]>([]);
  const [digest, setDigest] = useState<MonthlyDigest | null>(null);
  const [mLoading, setMLoading] = useState(false);

  // ----- PDF / 슬랙 -----
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  // 화면(업무일지 본문) 그대로 PDF 파일로 저장 — 인쇄창 없이 다운로드
  async function saveScreenPdf() {
    const el = reportRef.current;
    if (!el || capturing) return;
    setCapturing(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        ignoreElements: (n) => n.tagName === "BUTTON",
      });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pw) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, "PNG", 0, position, pw, imgH);
      heightLeft -= ph;
      while (heightLeft > 0) {
        position -= ph;
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, position, pw, imgH);
        heightLeft -= ph;
      }
      pdf.save(`업무일지_${selected ?? todayIso()}.pdf`);
    } catch (e) {
      setSendMsg("PDF 저장 실패: " + String(e instanceof Error ? e.message : e));
    } finally {
      setCapturing(false);
    }
  }

  function applyResponse(r: { dates: string[]; report?: WorklogReport | null; date?: string; exists?: boolean }) {
    setDates(r.dates);
    const d = r.report?.date ?? r.date ?? null;
    setSelected(d);
    if (d) setCalYm(d.slice(0, 7));
    setReport(r.report ?? null);
    setMissing(!r.exists);
    setNote(r.report?.note ?? "");
    setSavedNote(r.report?.note ?? "");
    setSavedAt(r.report?.noteUpdatedAt ?? null);
    setError(null);
  }

  async function load(date?: string) {
    setLoading(true);
    try {
      applyResponse(await fetchWorklog(date));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      applyResponse(await generateWorklog());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  }
  async function handleSaveNote() {
    const date = selected ?? todayIso();
    setSaving(true);
    try {
      applyResponse(await saveWorklogNote(date, note));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }
  async function handleSendSlack() {
    if (sending) return;
    setSending(true);
    setSendMsg(null);
    try {
      await sendWorklogSlack(selected ?? todayIso());
      setSendMsg("✅ 대표님 슬랙으로 전송했습니다.");
    } catch (e) {
      setSendMsg("전송 실패: " + String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  async function loadMonthly(month?: string) {
    setMLoading(true);
    try {
      const r = await fetchMonthlyWorklog(month);
      setMonths(r.months);
      setDigest(r.digest ?? null);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setMLoading(false);
    }
  }
  useEffect(() => {
    if (mode === "monthly" && !digest) loadMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const activeDate = selected ?? todayIso();
  const noteDirty = note !== savedNote;

  if (loading && !report && mode === "daily") return <div className="state">업무일지를 불러오는 중…</div>;

  // 캘린더 셀 계산
  const [cy, cm] = calYm.split("-").map(Number); // cy=연, cm=월(1~12)
  const firstDow = new Date(cy, cm - 1, 1).getDay();
  const dim = new Date(cy, cm, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(`${calYm}-${String(d).padStart(2, "0")}`);
  const shiftMonth = (delta: number) => {
    const nd = new Date(cy, cm - 1 + delta, 1);
    setCalYm(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="sales" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="seg">
        <button className={mode === "daily" ? "is-active" : ""} onClick={() => setMode("daily")}>📅 일간</button>
        <button className={mode === "monthly" ? "is-active" : ""} onClick={() => setMode("monthly")}>🗓️ 월간</button>
      </div>

      {error && <div className="state state--error">{error}</div>}

      {mode === "daily" ? (
        <>
        <div className="sales__toolbar wl-print-hide" style={{ justifyContent: "flex-end", gap: 8 }}>
          {sendMsg && <span className="sales__updated" style={{ marginRight: "auto" }}>{sendMsg}</span>}
          <button className="sync-btn" onClick={saveScreenPdf} disabled={capturing}>{capturing ? "저장 중…" : "📄 PDF 저장 (화면 그대로)"}</button>
          <a className="sync-btn" href={worklogPdfUrl(activeDate)} target="_blank" rel="noreferrer">📄 문서형 PDF</a>
          <button className="sync-btn" onClick={handleSendSlack} disabled={sending}>
            {sending ? "전송 중…" : "📨 대표님께 전송"}
          </button>
        </div>
        <div className="wl-grid">
          {/* 캘린더 */}
          <section className="card wl-cal-card">
            <div className="wl-cal-head">
              <button className="sync-btn" onClick={() => shiftMonth(-1)}>‹</button>
              <b>{cy}년 {cm}월</b>
              <button className="sync-btn" onClick={() => shiftMonth(1)}>›</button>
            </div>
            <div className="wl-cal">
              {WEEK.map((w) => <div key={w} className="wl-cal__w">{w}</div>)}
              {cells.map((iso, i) =>
                iso ? (
                  <button
                    key={iso}
                    className={
                      "wl-cal__d" +
                      (iso === activeDate ? " is-sel" : "") +
                      (iso === todayIso() ? " today" : "")
                    }
                    onClick={() => load(iso)}
                  >
                    {Number(iso.slice(-2))}
                    {dates.includes(iso) && <span className="wl-cal__dot" />}
                  </button>
                ) : (
                  <div key={"e" + i} />
                )
              )}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>● 표시일 = 업무일지 있음 · 날짜를 눌러 보기/작성</p>
            <button className="sync-btn" style={{ marginTop: 8, width: "100%" }} onClick={handleGenerate} disabled={generating}>
              {generating ? "생성 중…" : "📝 오늘 자동집계 생성"}
            </button>
          </section>

          {/* 선택일 리포트 */}
          <div className="wl-report" ref={reportRef}>
            {report && (report.summary.total > 0 || report.digest || report.aiComment) && (
              <>
                {/* ── 한눈 요약: 세 줄 + 숫자 (전체폭, 맨 위) ── */}
                {report.digest?.threeLine && report.digest.threeLine.length > 0 && (
                  <section className="card card--wide brief-three">
                    <div className="brief-cap">세 줄 요약</div>
                    {report.digest.threeLine.map((l, i) => <p key={i}>{l}</p>)}
                  </section>
                )}
                <div className="sales__kpis">
                  <Kpi label="오늘 완료" value={report.summary.doneToday} tone="#047857" />
                  <Kpi label="진행 중" value={report.summary.inProgress} tone="#1d4ed8" />
                  <Kpi label="보류 중" value={report.summary.onHold} tone="#b45309" />
                  <Kpi label="업무 대기" value={report.summary.waiting} />
                  <Kpi label="정체" value={report.summary.stale} tone={report.summary.stale > 0 ? "#b91c1c" : undefined} />
                </div>

                {/* ── 상세 2열(masonry) ── */}
                <div className="wl-detail">
                  {/* 01 하루의 흐름 */}
                  {report.digest?.flow && report.digest.flow.length > 0 && (
                    <section className="card card--wide">
                      <div className="brief-sec-h"><span className="no">01</span><h2>하루의 흐름</h2></div>
                      <ul className="brief-flow">
                        {report.digest.flow.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </section>
                  )}

                  {/* 02 오늘의 이야기 */}
                  {report.digest?.stories && report.digest.stories.length > 0 && (
                    <section className="card card--wide">
                      <div className="brief-sec-h"><span className="no">02</span><h2>오늘의 이야기</h2></div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {report.digest.stories.map((s, i) => <StoryCard key={i} s={s} />)}
                      </div>
                    </section>
                  )}

                  {/* AI 코멘트 (브리핑 없을 때 대체) */}
                  {!report.digest && report.aiComment && (
                    <section className="card card--wide">
                      <h2 className="card__title">🧠 오늘 요약</h2>
                      <p style={{ margin: 0, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text)" }}>{report.aiComment}</p>
                    </section>
                  )}

                  {/* 03 구성원별 하루 (전체폭 + 구성원 그리드로 압축) */}
                  {report.assignees.length > 0 && (
                    <section className="card card--wide wl-span">
                      <div className="brief-sec-h"><span className="no">03</span><h2>구성원별 하루</h2></div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "6px 26px" }}>
                        {report.assignees.map((a) => <AssigneeBlock key={a.name} a={a} />)}
                      </div>
                    </section>
                  )}

                  {/* CS 상담 내역 (채널톡 매장별 — 영업폰은 수기) */}
                  {report.csStores && report.csStores.length > 0 && (
                    <section className="card card--wide wl-span">
                      <div className="brief-sec-h"><span className="no">💬</span><h2>CS 상담 내역 <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· 채널톡 매장별(영업폰 인입은 수기)</span></h2></div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px 26px" }}>
                        {report.csStores.map((cs) => (
                          <div key={cs.assignee}>
                            <div style={{ fontWeight: 700, marginBottom: 6, color: "#1e40af" }}>{cs.assignee} <span className="muted" style={{ fontWeight: 400 }}>· {cs.items.length}건</span></div>
                            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                              {cs.items.map((it, i) => (
                                <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                                  <b>{it.url ? <a href={it.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{it.label}</a> : it.label}</b> — {it.summary || "(요약 없음)"}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 04 지켜볼 것 */}
                  {report.digest?.watch && report.digest.watch.length > 0 && (
                    <section className="card card--wide">
                      <div className="brief-sec-h"><span className="no">04</span><h2>지켜볼 것</h2></div>
                      {report.digest.watch.map((w, i) => (
                        <div key={i} className="brief-iss">
                          {w.badge && <span className="brief-iss__badge">{w.badge}</span>}
                          <div><div className="brief-iss__t">{w.title}</div><div className="brief-iss__m">{w.note}</div></div>
                        </div>
                      ))}
                    </section>
                  )}

                  {/* 05 내일 */}
                  {report.digest?.tomorrow && report.digest.tomorrow.length > 0 && (
                    <section className="card card--wide">
                      <div className="brief-sec-h"><span className="no">05</span><h2>내일</h2></div>
                      <ul className="brief-tmr">
                        {report.digest.tomorrow.map((t, i) => <li key={i}>{t}</li>)}
                      </ul>
                    </section>
                  )}
                </div>
              </>
            )}

            {/* ── 직접 작성 + 채널톡 리포트 (아래로) ── */}
            <div className="wl-detail">
              <div className="card card--wide">
                <h2 className="card__title">✍️ {activeDate} 업무일지 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 언제든 직접 작성</span></h2>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={5}
                  placeholder={"오늘 한 일·진행 상황·내일 일정 등을 자유롭게 기재하세요."}
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: "12px 14px", fontSize: 14, lineHeight: 1.7, fontFamily: "inherit", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                  <button className="sync-btn" onClick={handleSaveNote} disabled={saving || !noteDirty}>
                    {saving ? "저장 중…" : noteDirty ? "💾 저장" : "저장됨"}
                  </button>
                  {!noteDirty && savedAt && <span className="sales__updated">마지막 저장 {new Date(savedAt).toLocaleString("ko-KR")}</span>}
                </div>
              </div>

              <CsReportCard date={activeDate} />
            </div>

            {missing && !report?.aiComment && !(report && report.summary.total > 0) && (
              <div className="state" style={{ fontSize: 13 }}>
                이 날짜엔 자동집계 일지가 없습니다. 위에서 직접 작성하거나, 오늘이면 "오늘 자동집계 생성"으로 만들 수 있어요.
              </div>
            )}
          </div>
        </div>
        </>
      ) : (
        /* ===== 월간 ===== */
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="sales__toolbar">
            {months.length > 0 && (
              <select className="agent__select" style={{ width: "auto" }} value={digest?.month ?? ""} onChange={(e) => loadMonthly(e.target.value)}>
                {months.map((m) => <option key={m} value={m}>{m.replace("-", "년 ")}월</option>)}
              </select>
            )}
            <span className="sales__updated">매월 1일, 직전 월 일일일지를 자동 종합합니다.</span>
          </div>
          {mLoading && <div className="state">월간 업무일지 불러오는 중…</div>}
          {digest && (
            <>
              {digest.ai?.threeLine && digest.ai.threeLine.length > 0 && (
                <section className="card card--wide brief-three">
                  <div className="brief-cap">세 줄 요약</div>
                  {digest.ai.threeLine.map((l, i) => <p key={i}>{l}</p>)}
                </section>
              )}
              <div className="sales__kpis">
                <Kpi label="집계 일수" value={digest.dayCount} />
                <Kpi label="총 완료 업무" value={digest.doneTotal} tone="#047857" />
                <Kpi label="구성원" value={digest.people.length} />
              </div>
              {digest.ai?.highlights && digest.ai.highlights.length > 0 && (
                <section className="card card--wide">
                  <div className="brief-sec-h"><span className="no">01</span><h2>이달의 하이라이트</h2></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {digest.ai.highlights.map((h, i) => (
                      <div key={i} className="brief-story">
                        <div style={{ minWidth: 0 }}>
                          <h3 style={{ fontSize: 14.5, fontWeight: 800, margin: 0 }}>{h.headline}</h3>
                          <p style={{ fontSize: 13, color: "var(--muted)", margin: "5px 0 0", lineHeight: 1.6 }}>{h.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section className="card card--wide">
                <h2 className="card__title">{digest.month.replace("-", "년 ")}월 · 구성원별 완료</h2>
                {digest.people.length === 0 ? (
                  <div className="state">집계된 완료 업무가 없습니다.</div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>담당자</th><th style={{ textAlign: "right" }}>완료 업무</th></tr></thead>
                    <tbody>
                      {digest.people.map((p) => (
                        <tr key={p.name}>
                          <td style={{ fontWeight: 600 }}>{p.name}{p.role && <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>{p.role}</span>}</td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>{p.done}건</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              {digest.notes.length > 0 && (
                <section className="card card--wide">
                  <h2 className="card__title">직접 작성 모음 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>({digest.notes.length}일)</span></h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {digest.notes.map((nt) => (
                      <div key={nt.date} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{nt.date}</div>
                        <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)" }}>{nt.note}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 채널톡 일일 리포트(서비스별 비율 + 담당자별) — 전화·채팅·카카오 전부 채널톡 API 자동
function CsReportCard({ date }: { date: string }) {
  const [rep, setRep] = useState<CsReport | null>(null);
  const [loading, setLoading] = useState(false);

  function load(force = false) {
    setLoading(true);
    getCsReport(date, force)
      .then((r) => setRep(r))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);

  const rows = rep?.rows ?? [];
  const pPhone = rep?.totalPhone ?? 0;
  const pChat = rep?.totalChat ?? 0;
  const pKakao = rep?.totalKakao ?? 0;
  const pTot = pPhone + pChat + pKakao;
  const pct = (n: number) => (pTot ? Math.round((n / pTot) * 100) : 0);
  const sum = (k: "phone" | "chat" | "kakao") => rows.reduce((s, r) => s + (r[k] || 0), 0);

  return (
    <section className="card card--wide">
      <div className="brief-sec-h">
        <span className="no">📊</span><h2>채널톡 일일 리포트</h2>
        <span className="ln" style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>전화·채팅·카카오 모두 자동</span>
      </div>

      {/* 서비스별 상담 인입 비율 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>서비스별 상담 인입 비율</div>
        <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", background: "var(--border)" }}>
          <div style={{ width: `${pct(pPhone)}%`, background: "#7c6df2" }} />
          <div style={{ width: `${pct(pChat)}%`, background: "#4dd0c4" }} />
          <div style={{ width: `${pct(pKakao)}%`, background: "#ffb35c" }} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span style={{ color: "#7c6df2", fontWeight: 700 }}>● 전화 {pct(pPhone)}%({pPhone})</span>
          <span style={{ color: "#2bb3a3", fontWeight: 700 }}>● 채널톡 메시지 {pct(pChat)}%({pChat})</span>
          <span style={{ color: "#f0973a", fontWeight: 700 }}>● 카카오 {pct(pKakao)}%({pKakao})</span>
        </div>
      </div>

      {/* 담당자별 인입된 상담 수 */}
      <table className="data-table">
        <thead>
          <tr>
            <th>담당자</th>
            <th style={{ textAlign: "right" }}>전체</th>
            <th style={{ textAlign: "right" }}>전화상담</th>
            <th style={{ textAlign: "right" }}>채팅상담</th>
            <th style={{ textAlign: "right" }}>카카오</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{(r.phone || 0) + (r.chat || 0) + (r.kakao || 0)}</td>
              <td style={{ textAlign: "right" }}>{r.phone || 0}</td>
              <td style={{ textAlign: "right" }}>{r.chat || 0}</td>
              <td style={{ textAlign: "right" }}>{r.kakao || 0}</td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 800 }}>합계</td>
            <td style={{ textAlign: "right", fontWeight: 800 }}>{sum("phone") + sum("chat") + sum("kakao")}</td>
            <td style={{ textAlign: "right", fontWeight: 700 }}>{sum("phone")}</td>
            <td style={{ textAlign: "right", fontWeight: 700 }}>{sum("chat")}</td>
            <td style={{ textAlign: "right", fontWeight: 700 }}>{sum("kakao")}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <button className="sync-btn wl-print-hide" onClick={() => load(true)} disabled={loading}>{loading ? "불러오는 중…" : "🔄 새로고침"}</button>
        {rep?.updatedAt && <span className="sales__updated">채널톡 {new Date(rep.updatedAt).toLocaleString("ko-KR")} 기준</span>}
        {rep?.note && <span className="muted" style={{ fontSize: 11 }}>{rep.note}</span>}
        <span className="muted" style={{ fontSize: 11 }}>담당자 합계와 파이 총계는 미배정·기타 상담원 때문에 다를 수 있습니다.</span>
      </div>
    </section>
  );
}

function AssigneeBlock({ a }: { a: WorklogAssignee }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
        {a.name}
        {a.role && <span className="muted" style={{ marginLeft: 6, fontWeight: 400, fontSize: 13 }}>{a.role}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <TaskGroup title="오늘 완료" color="#047857" items={a.done} />
        <TaskGroup title="진행 중" color="#1d4ed8" items={a.inProgress} />
        <TaskGroup title="보류" color="#b45309" items={a.onHold} />
        {a.staleItems.length > 0 && <TaskGroup title="정체" color="#b91c1c" items={a.staleItems} />}
      </div>
    </div>
  );
}

function TaskGroup({ title, color, items }: { title: string; color: string; items: WorklogTaskLite[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 6 }}>
        {title} <span style={{ opacity: 0.7 }}>{items.length}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((t, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
            <a href={t.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "none" }}>{t.name}</a>
            {t.priority === "높음" && <span style={{ color: "#b91c1c", marginLeft: 4, fontSize: 11 }}>●</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StoryCard({ s }: { s: DigestStory }) {
  const tone = s.kind === "성과" ? "#1f9d64" : s.kind === "걸림돌" ? "#c08a2e" : "#3a45d1";
  const bg = s.kind === "성과" ? "#e9f5ef" : s.kind === "걸림돌" ? "#faf3e3" : "#eef0fb";
  return (
    <div className="brief-story">
      <div className="brief-story__side">
        <span className="brief-story__kk" style={{ color: tone, background: bg }}>{s.kind}</span>
        {s.num != null && <div className="brief-story__num" style={{ color: tone }}>{s.num}</div>}
      </div>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ fontSize: 14.5, fontWeight: 800, margin: 0 }}>{s.headline}</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "5px 0 0", lineHeight: 1.6 }}>{s.body}</p>
        {s.by && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>{s.by}</div>}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <section className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__amount" style={{ color: tone }}>{value}건</div>
    </section>
  );
}
