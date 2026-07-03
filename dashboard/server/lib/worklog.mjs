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

// ===== 업무일지 → PDF용 HTML (데일리 브리핑 레이아웃) =====
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function buildWorklogHtml(report) {
  const d = report.digest || {};
  const s = report.summary || {};
  const cs = report.cs;
  const num = (n) => Number(n || 0).toLocaleString("ko-KR");
  const stories = (d.stories || []).map((st) => `
    <div class="story ${st.kind === "성과" ? "g" : st.kind === "걸림돌" ? "w" : "t"}">
      <div class="side"><span class="kk">${esc(st.kind)}</span>${st.num != null ? `<div class="bignum">${esc(st.num)}</div>` : ""}</div>
      <div><h3>${esc(st.headline)}</h3><p>${esc(st.body)}</p>${st.by ? `<div class="by">${esc(st.by)}</div>` : ""}</div>
    </div>`).join("");
  const flow = (d.flow || []).map((f) => `<li>${esc(f)}</li>`).join("");
  const crew = (report.assignees || []).map((a) => {
    const line = (label, arr) => (arr && arr.length ? `<div><b>${label}</b> ${arr.map((t) => esc(t.name)).join(", ")}</div>` : "");
    return `<div class="pc"><div class="nm">${esc(a.name)}${a.role ? ` <span>${esc(a.role)}</span>` : ""}</div>
      ${line("오늘 완료", a.done)}${line("진행", a.inProgress)}${line("보류", a.onHold)}${line("정체", a.staleItems)}</div>`;
  }).join("");
  const watch = (d.watch || []).map((w) => `<div class="iss"><div class="db">${esc(w.badge || "")}</div><div><div class="t">${esc(w.title)}</div><div class="m">${esc(w.note)}</div></div></div>`).join("");
  const tomorrow = (d.tomorrow || []).map((t) => `<li>${esc(t)}</li>`).join("");
  const csHtml = cs ? `<div class="csbox"><b>채널톡</b> 채팅 인입 ${num(cs.inbound)} · 대기 ${num(cs.waiting)}${(cs.byAgent || []).length ? " — " + cs.byAgent.map((a) => esc(a.name) + " " + a.handled).join(", ") : ""}</div>` : "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;} body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#1b1e24;padding:26px 30px;font-size:12.5px;line-height:1.6;}
    .mast{text-align:center;border-bottom:2px solid #1b1e24;padding-bottom:12px;margin-bottom:16px;} .mast .co{font-size:10px;letter-spacing:.3em;color:#999;font-weight:700;} .mast h1{font-size:22px;font-weight:800;margin-top:6px;} .mast h1 span{color:#b98a2e;} .mast .d{font-size:11px;color:#666;margin-top:4px;}
    .three{background:#f7f7f4;border:1px solid #eee;border-radius:10px;padding:13px 18px;margin-bottom:14px;text-align:center;} .three p{font-size:14px;font-weight:700;}
    .nums{display:flex;border-top:1px solid #eee;border-bottom:1px solid #eee;margin-bottom:14px;} .nums .n{flex:1;text-align:center;padding:9px;border-left:1px solid #eee;} .nums .n:first-child{border-left:none;} .nums .v{font-size:18px;font-weight:800;} .nums .l{font-size:10px;color:#999;margin-top:2px;}
    .csbox{background:#f4f7ff;border:1px solid #e5ecff;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:11.5px;}
    h2.sec{font-size:13px;font-weight:800;margin:14px 0 8px;border-left:3px solid #b98a2e;padding-left:8px;}
    .story{border:1px solid #eee;border-radius:10px;padding:10px 14px;margin-bottom:7px;display:flex;gap:12px;break-inside:avoid;} .story .side{width:50px;text-align:center;flex-shrink:0;} .story .kk{font-size:9px;font-weight:800;border-radius:12px;padding:2px 6px;display:inline-block;} .story.g .kk{background:#e9f5ef;color:#1f9d64;} .story.t .kk{background:#eef0fb;color:#3a45d1;} .story.w .kk{background:#faf3e3;color:#b98a2e;} .story .bignum{font-size:22px;font-weight:800;margin-top:4px;} .story h3{font-size:13px;} .story p{font-size:11.5px;color:#555;} .story .by{font-size:10px;color:#999;margin-top:4px;}
    ul{margin:0 0 10px 18px;font-size:12px;} .pc{border:1px solid #eee;border-radius:10px;padding:9px 14px;margin-bottom:7px;break-inside:avoid;} .pc .nm{font-weight:800;font-size:13px;margin-bottom:3px;} .pc .nm span{font-size:10px;color:#999;font-weight:500;} .pc>div{font-size:11.5px;color:#555;} .pc b{color:#333;}
    .iss{display:flex;gap:10px;padding:6px 0;border-top:1px solid #f0f0f0;} .iss:first-child{border-top:none;} .iss .db{background:#faf3e3;color:#b98a2e;border-radius:8px;padding:3px 8px;font-size:10px;font-weight:800;white-space:nowrap;} .iss .t{font-weight:700;font-size:12px;} .iss .m{font-size:10.5px;color:#777;}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  </style></head><body>
    <div class="mast"><div class="co">DAIN I&amp;C</div><h1>데일리 <span>브리핑</span></h1><div class="d">${esc(report.date)} · 업무일지</div></div>
    ${(d.threeLine || []).length ? `<div class="three">${(d.threeLine || []).map((l) => `<p>${esc(l)}</p>`).join("")}</div>` : ""}
    <div class="nums">
      <div class="n"><div class="v">${num(s.doneToday)}</div><div class="l">오늘 완료</div></div>
      <div class="n"><div class="v">${num(s.inProgress)}</div><div class="l">진행 중</div></div>
      <div class="n"><div class="v">${num(s.onHold)}</div><div class="l">보류</div></div>
      <div class="n"><div class="v">${num(s.waiting)}</div><div class="l">대기</div></div>
      <div class="n"><div class="v">${num(s.stale)}</div><div class="l">정체</div></div>
    </div>
    ${csHtml}
    ${flow ? `<h2 class="sec">하루의 흐름</h2><ul>${flow}</ul>` : ""}
    ${stories ? `<h2 class="sec">오늘의 이야기</h2>${stories}` : ""}
    ${crew ? `<h2 class="sec">구성원별 하루</h2>${crew}` : ""}
    <div class="grid2">
      ${watch ? `<div><h2 class="sec">지켜볼 것</h2>${watch}</div>` : ""}
      ${tomorrow ? `<div><h2 class="sec">내일</h2><ul>${tomorrow}</ul></div>` : ""}
    </div>
    ${report.note ? `<h2 class="sec">직접 작성</h2><div style="white-space:pre-wrap;font-size:12px;">${esc(report.note)}</div>` : ""}
  </body></html>`;
}

// Claude 호출 → JSON 파싱(공용)
async function claudeJson(system, user, apiKey, maxTokens = 1500) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `Claude API ${r.status}`);
  let txt = (j.content ?? []).map((b) => b.text || "").join("").trim();
  txt = txt.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(txt);
}

// 데일리 브리핑(구조화) — 세 줄 요약 · 오늘의 이야기 · 지켜볼 것 · 내일
export async function generateDigest(data, apiKey) {
  if (!apiKey) return null;
  const system =
    "너는 다인아이앤씨 팀의 업무 보조다. 하루치 업무 데이터를 받아 팀장이 한 장으로 읽는 '데일리 브리핑'을 만든다. " +
    "데이터에 실제로 있는 사실만 쓰고 지어내지 마라. 담백하고 실무적인 한국어. 반드시 아래 JSON 객체만 출력하고 코드펜스·설명은 쓰지 마라.";
  const schema =
    '{"threeLine":["핵심 한 줄","둘째 줄","셋째 줄(주의·걸림돌 관점)"],' +
    '"flow":["하루의 흐름을 순서대로 3~6개 항목으로(시각 없이, 무엇을 했는지 한 줄씩)"],' +
    '"stories":[{"kind":"성과","num":숫자 또는 null,"headline":"짧은 제목","body":"2~3문장","by":"담당자 등"}],' +
    '"watch":[{"badge":"예: 정체·N건","title":"짧게","note":"한 줄"}],' +
    '"tomorrow":["내일 할 일 1","내일 할 일 2"]}';
  const user =
    worklogToText(data) +
    "\n\n위 데이터로 데일리 브리핑을 작성하라. stories 의 kind 는 성과/진전/걸림돌 중 데이터에 해당하는 것만(없으면 생략). 없는 항목은 빈 배열로. 출력 JSON:\n" +
    schema;
  try {
    return await claudeJson(system, user, apiKey);
  } catch (e) {
    console.warn("데일리 브리핑 생성 실패(무시):", String(e?.message ?? e));
    return null;
  }
}

// 월간 브리핑(구조화) — 한 달 종합 서술
export async function generateMonthlyDigest(monthText, apiKey) {
  if (!apiKey) return null;
  const system =
    "너는 다인아이앤씨 팀의 업무 보조다. 한 달치 업무 종합 데이터를 받아 '월간 브리핑'을 만든다. " +
    "데이터에 있는 사실만 쓰고 지어내지 마라. 담백한 한국어. 반드시 아래 JSON 객체만 출력.";
  const schema =
    '{"threeLine":["한 달 핵심 한 줄","둘째 줄","셋째 줄"],' +
    '"highlights":[{"headline":"짧은 제목","body":"2~3문장"}]}';
  try {
    return await claudeJson(system, monthText + "\n\n출력 JSON:\n" + schema, apiKey, 1500);
  } catch (e) {
    console.warn("월간 브리핑 생성 실패(무시):", String(e?.message ?? e));
    return null;
  }
}
