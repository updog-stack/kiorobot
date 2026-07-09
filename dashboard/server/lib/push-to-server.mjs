// 로컬 수집 결과를 운영 서버로 업로드(로그인 후 POST). .env 에 SERVER_URL + APP_PASSWORD 필요.
// 미설정 시 조용히 스킵(로컬 전용으로 동작).
export async function pushToServer(apiPath, data, env = process.env) {
  const base = (env.SERVER_URL || "").replace(/\/$/, "");
  const pw = env.APP_PASSWORD;
  if (!base || !pw) return;
  try {
    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const setCookie = (login.headers.getSetCookie?.() || []).join("; ") || login.headers.get("set-cookie") || "";
    const cookie = setCookie.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    if (!cookie) throw new Error("로그인 쿠키 없음(비번 확인)");
    const r = await fetch(`${base}${apiPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    console.log(`  ↑ 서버 업로드 OK: ${apiPath}`);
  } catch (e) {
    console.log(`  ↑ 서버 업로드 실패(${apiPath}): ${e.message}`);
  }
}
