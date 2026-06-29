// 로그인(접근제어) 클라이언트. 서버(/api/session·/api/login·/api/logout)와 연동.
// 세션은 httpOnly 쿠키라 JS에서 토큰을 직접 다루지 않는다(같은 출처 자동 전송).

export interface SessionInfo {
  authRequired: boolean; // 서버에 APP_PASSWORD 설정 여부
  authed: boolean; // 현재 로그인 상태(또는 인증 비활성)
}

export async function getSession(): Promise<SessionInfo> {
  const res = await fetch("/api/session");
  if (!res.ok) throw new Error(`세션 확인 실패: ${res.status}`);
  return (await res.json()) as SessionInfo;
}

export async function login(password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.status === 429)
    throw new Error("로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.");
  if (!res.ok) throw new Error("비밀번호가 올바르지 않습니다.");
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}
