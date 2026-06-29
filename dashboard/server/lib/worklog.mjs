// 업무일지 생성 — 노션 [업무 DB]의 정규화된 task 배열을 받아
// 하루치 일지(요약 + 담당자별 + AI 코멘트)로 정리한다.
//
// 저장은 BFF(notion-sales-bff.mjs)가 server/data/worklogs/<날짜>.json 로 담당.

// 완료 판정 기준일 (완료일 → 마지막상태변경일 → 마지막변경시각)
function doneOn(t) {
  return (t.doneDate || t.lastStatusChange || t.lastEdited || "").slice(0, 10);
}

const lite = (t) => ({ name: t.name, url: t.url, priority: t.priority, stale: !!t.stale, depts: t.depts || [] });

// 결정적(AI 불필요) 일지 데이터 구성. dateIso = "YYYY-MM-DD"(대상 날짜)
export function buildWorklogData(tasks, dateIso) {
  const active = tasks.filter((t) => !t.trash && t.status !== "휴지통");

  const doneToday = active.filter((t) => t.status === "처리완료" && doneOn(t) === dateIso);
  const inProgress = active.filter((t) => t.status === "진행중");
  const onHold = active.filter((t) => t.status === "보류중");
  const waiting = active.filter((t) => t.status === "업무대기");
  const stale = active.filter((t) => t.stale && t.status !== "처리완료");

  const summary = {
    total: active.length,
    doneToday: doneToday.length,
    inProgress: inProgress.length,
    onHold: onHold.length,
    waiting: waiting.length,
    stale: stale.length,
  };

  // 담당자별 묶음
  const map = new Map();
  const ensure = (name, role) => {
    if (!map.has(name))
      map.set(name, { name, role: role || null, done: [], inProgress: [], onHold: [], waiting: [], staleItems: [] });
    const r = map.get(name);
    if (!r.role && role) r.role = role;
    return r;
  };
  for (const t of doneToday) ensure(t.assignee, t.role).done.push(lite(t));
  for (const t of inProgress) ensure(t.assignee, t.role).inProgress.push(lite(t));
  for (const t of onHold) ensure(t.assignee, t.role).onHold.push(lite(t));
  for (const t of waiting) ensure(t.assignee, t.role).waiting.push(lite(t));
  for (const t of stale) ensure(t.assignee, t.role).staleItems.push(lite(t));

  const assignees = [...map.values()].sort(
    (a, b) =>
      b.done.length + b.inProgress.length - (a.done.length + a.inProgress.length) ||
      a.name.localeCompare(b.name)
  );

  return { date: dateIso, summary, assignees };
}

// 사람이 읽기 좋은 텍스트(AI 입력 + 보조 표시용)
export function worklogToText(data) {
  const s = data.summary;
  const lines = [];
  lines.push(`■ ${data.date} 업무일지`);
  lines.push(
    `요약 — 전체 ${s.total} · 오늘완료 ${s.doneToday} · 진행중 ${s.inProgress} · 보류 ${s.onHold} · 대기 ${s.waiting} · 정체 ${s.stale}`
  );
  for (const a of data.assignees) {
    const head = `\n· ${a.name}${a.role ? `(${a.role})` : ""}`;
    lines.push(head);
    if (a.done.length) lines.push(`  [오늘 완료] ${a.done.map((t) => t.name).join(" / ")}`);
    if (a.inProgress.length) lines.push(`  [진행중] ${a.inProgress.map((t) => t.name).join(" / ")}`);
    if (a.onHold.length) lines.push(`  [보류] ${a.onHold.map((t) => t.name).join(" / ")}`);
    if (a.staleItems.length) lines.push(`  [정체] ${a.staleItems.map((t) => t.name).join(" / ")}`);
  }
  return lines.join("\n");
}

// AI 코멘트(선택) — 키 없거나 실패 시 null 반환(일지 생성 자체는 막지 않음)
export async function generateAiComment(data, apiKey) {
  if (!apiKey) return null;
  const system =
    "당신은 중소기업 팀의 업무 보조입니다. 주어진 하루치 업무 데이터를 바탕으로 팀장이 한눈에 볼 수 있는 " +
    "업무일지 코멘트를 한국어로 작성하세요. 3~5문장. 오늘 완료된 핵심 성과, 진행 중 주요 업무, " +
    "주의가 필요한 정체/보류 업무를 자연스럽게 짚되, 데이터에 없는 내용은 지어내지 마세요. " +
    "담백하고 실무적인 어조로, 마크다운·머리말 없이 평문으로만 출력하세요.";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: worklogToText(data) }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `Claude API ${r.status}`);
    const text = (j.content ?? []).map((b) => b.text || "").join("").trim();
    return text || null;
  } catch (e) {
    console.warn("업무일지 AI 코멘트 생성 실패(무시):", String(e?.message ?? e));
    return null;
  }
}
