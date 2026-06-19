// Gmail(IMAP)에서 인증번호 메일을 읽어 코드를 추출.
// DDWM 인증메일: 발신 "DDWM 관리자", 제목 "[인증번호:863587]DAOUDATA WEB MANAGEMENT ..."
//
// 필요: .env 의 GMAIL_USER / GMAIL_APP_PASSWORD (Google 앱 비밀번호)

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const DEFAULT_RE = /인증번호\s*[:：]?\s*(\d{4,8})/;

// 로그인 직전 호출 → 현재 받은편지함에서 가장 최근의 (match) 인증메일 시각(ms) 반환.
// 이후 getVerificationCode({ sinceMs: 이값+1 }) 로 '새 메일'만 확실히 읽기 위함.
export async function latestCodeMailTime({ user, pass, match = "" } = {}) {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  let latest = 0;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 30 * 60 * 1000);
      for await (const m of client.fetch({ since }, { envelope: true, internalDate: true })) {
        const subject = m.envelope?.subject || "";
        const from = (m.envelope?.from || []).map((f) => `${f.name || ""} ${f.address || ""}`).join(" ");
        if (match && !`${from} ${subject}`.includes(match)) continue;
        if (!DEFAULT_RE.test(subject)) continue;
        latest = Math.max(latest, m.internalDate.getTime());
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return latest;
}

export async function getVerificationCode({
  user,
  pass,
  sinceMs = Date.now() - 5 * 60 * 1000, // 이 시각 이후 도착한 메일만
  match = "", // 발신자/제목에 포함돼야 하는 문자열 (예: "DDWM")
  codeRegex = DEFAULT_RE,
  timeoutMs = 120000,
  pollMs = 5000,
} = {}) {
  if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD 가 필요합니다.");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user, pass },
      logger: false,
    });
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const since = new Date(Date.now() - 15 * 60 * 1000); // 최근 15분
        const msgs = [];
        for await (const m of client.fetch(
          { since },
          { envelope: true, internalDate: true, source: true }
        )) {
          msgs.push(m);
        }
        msgs.sort((a, b) => b.internalDate - a.internalDate); // 최신순

        for (const m of msgs) {
          if (m.internalDate.getTime() < sinceMs) continue;
          const subject = m.envelope?.subject || "";
          const from = (m.envelope?.from || [])
            .map((f) => `${f.name || ""} ${f.address || ""}`)
            .join(" ");
          if (match && !`${from} ${subject}`.includes(match)) continue;

          // 제목에서 우선 추출
          let mm = subject.match(codeRegex);
          if (!mm && m.source) {
            const parsed = await simpleParser(m.source);
            const text = `${parsed.subject || ""}\n${parsed.text || ""}`;
            mm = text.match(codeRegex);
          }
          if (mm) return mm[1];
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("인증번호 메일을 찾지 못했습니다(시간 초과).");
}
