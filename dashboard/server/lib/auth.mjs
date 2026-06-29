// 앱 로그인(접근제어) — 외부 서버 오픈 대비.
//
// 방식: 공유 비밀번호 1개(APP_PASSWORD). 로그인 성공 시 HMAC 서명된
// 세션 토큰을 httpOnly 쿠키로 발급한다. 서버에 세션 저장소가 필요 없어
// (무상태) 재시작에도 견고하고, SESSION_SECRET 만 고정하면 토큰이 유지된다.
//
// 보안 메모(master.md 접근제어 요건):
//   - 비밀번호 비교/서명 검증은 timingSafeEqual 로 타이밍 공격 방지
//   - 쿠키는 httpOnly + SameSite=Lax, HTTPS 구간에서는 Secure 자동 부여
//   - APP_PASSWORD 미설정 시: 인증 비활성(개발 편의) + 기동 시 경고

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const DAY = 24 * 60 * 60 * 1000;
const SESSION_MS = 7 * DAY; // 로그인 유지 기간

export const COOKIE_NAME = "dain_auth";

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  // 길이가 다르면 timingSafeEqual 이 throw → 먼저 분기(길이는 비밀이 아님)
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function createAuth({ password, secret }) {
  const enabled = Boolean(password);
  // SESSION_SECRET 미설정이면 임시 시크릿 생성(재시작 시 전원 재로그인).
  const key = secret || randomBytes(32).toString("hex");
  const ephemeralSecret = !secret;

  const sign = (exp) =>
    createHmac("sha256", key).update(String(exp)).digest("base64url");

  function issueToken() {
    const exp = Date.now() + SESSION_MS;
    return `${exp}.${sign(exp)}`;
  }

  function verifyToken(token) {
    if (!token || typeof token !== "string") return false;
    const dot = token.lastIndexOf(".");
    if (dot < 0) return false;
    const exp = Number(token.slice(0, dot));
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    return safeEqual(token.slice(dot + 1), sign(exp));
  }

  const checkPassword = (input) => enabled && safeEqual(input, password);

  return {
    enabled,
    ephemeralSecret,
    sessionMs: SESSION_MS,
    issueToken,
    verifyToken,
    checkPassword,
  };
}

// "a=1; b=2" → { a:"1", b:"2" }
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Set-Cookie 문자열 구성. secure 는 HTTPS 구간에서만 켠다(localhost dev 대응).
export function buildCookie(name, value, { maxAgeMs, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (typeof maxAgeMs === "number") parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
