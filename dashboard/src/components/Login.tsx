import { useState } from "react";
import { login } from "../lib/auth";

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          다인ERP
          <span>경영 대시보드</span>
        </div>
        <label className="login__label" htmlFor="login-pw">
          비밀번호
        </label>
        <input
          id="login-pw"
          className="login__input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="접속 비밀번호"
        />
        {error && <p className="login__error">{error}</p>}
        <button className="login__btn" type="submit" disabled={busy || !password}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
