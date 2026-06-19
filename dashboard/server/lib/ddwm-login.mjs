// DDWM(다우데이타 VAN, van.daoudata.co.kr) 로그인 — 이메일 2차 인증 자동 처리.
// 검증됨: 로그인(span.btn.login) → 이메일 인증 팝업(#verifyCode) → Gmail에서 코드 읽기 → 인증(a.btn.ok)
//
// 필요: DDWM_ID / DDWM_PW / GMAIL_USER / GMAIL_APP_PASSWORD

import { getVerificationCode, latestCodeMailTime } from "./email-code.mjs";

const LOGIN_URL = "https://van.daoudata.co.kr/login";

export async function ddwmLogin(page, env = process.env) {
  const { DDWM_ID, DDWM_PW, GMAIL_USER, GMAIL_APP_PASSWORD } = env;
  if (!DDWM_ID || !DDWM_PW) throw new Error(".env 에 DDWM_ID / DDWM_PW 가 필요합니다.");
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD)
    throw new Error(".env 에 GMAIL_USER / GMAIL_APP_PASSWORD 가 필요합니다(이메일 인증).");

  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 40000 });
  await page.fill('input[name="id"]', DDWM_ID);
  await page.fill('input[name="password"]', DDWM_PW);

  // 로그인 직전, 기존 인증메일 중 최신 시각을 기준으로 잡아 '새 코드'만 읽도록 함
  // (연속 로그인 시 이전 코드 오인 방지)
  const baseline = await latestCodeMailTime({ user: GMAIL_USER, pass: GMAIL_APP_PASSWORD, match: "DAOUDATA" }).catch(() => 0);

  const t0 = Date.now();
  await page.click(".btn.login"); // 로그인(AJAX) → 자격증명 검증 → 이메일 인증 팝업

  // 인증 팝업 대기 (자격증명 오류면 #verifyCode 안 뜸)
  try {
    await page.waitForSelector("#verifyCode", { timeout: 15000, state: "visible" });
  } catch {
    const msg = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (/일치하지 않습니다|해지상태|권한이 없습니다/.test(msg))
      throw new Error("DDWM 로그인 실패: 아이디/비밀번호 또는 권한 오류");
    throw new Error("DDWM 이메일 인증 팝업이 나타나지 않았습니다.");
  }

  // 이메일에서 인증번호 추출
  const code = await getVerificationCode({
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
    match: "DAOUDATA",
    // 기존 최신 메일 이후(새 코드) 또는 t0-90s(클럭오차) 중 더 늦은 시각 이후
    sinceMs: Math.max(baseline + 1000, t0 - 90000),
    timeoutMs: 120000,
    pollMs: 5000,
  });

  await page.fill("#verifyCode", code);
  await page.click("a.btn.ok, .btn.ok");
  await page.waitForURL("**/main", { timeout: 20000 }).catch(() => {});
  if (!page.url().includes("/main"))
    throw new Error("DDWM 인증 후 메인 페이지 진입 실패(코드 오류/만료 가능).");

  return code;
}
