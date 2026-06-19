# KOVAN 일별TR현황 자동 수집 가이드

대시보드의 **거래(TR) 현황** 섹션은 KOVAN CATECA의 일별TR현황을 매일 자동 수집해 표시합니다.
대리점코드 **A25700** 기준, 올해 1월~현재월의 **월별 건수 · 월 평균 · 총합**.

## 흐름

```
[윈도우 작업 스케줄러 매일 08:00]
  → node server/kovan-tr-scraper.mjs
      로그인(cateca.kovan.com) → 일별TR현황 월별 조회(1~현재월) → 월별 건수 집계
  → server/data/tr.json 저장
[BFF] /api/tr  →  [대시보드] "거래(TR) 현황"
```

## 설정 (3단계)

### 1) 자격증명 입력 (`.env`)

```
KOVAN_ID=아이디
KOVAN_PW=비밀번호
KOVAN_AGENCY=A25700
```
> 비밀번호는 채팅에 붙이지 말고 `.env` 에만 넣으세요.

### 2) 수집 한번 실행 (테스트)

```bash
node server/kovan-tr-scraper.mjs
```
→ `server/data/tr.json` 생성. BFF 가 떠 있으면 대시보드에 즉시 반영됩니다.

### 3) 매일 08:00 자동화 등록 (윈도우)

```powershell
powershell -ExecutionPolicy Bypass -File server\register-tr-task.ps1
```
- 등록 확인: `Get-ScheduledTask -TaskName KOVAN-TR-Daily`
- 즉시 실행 테스트: `Start-ScheduledTask -TaskName KOVAN-TR-Daily`
- 제거: `Unregister-ScheduledTask -TaskName KOVAN-TR-Daily -Confirm:$false`

## 주의

- **이 PC가 08:00에 켜져 있어야** 실행됩니다(절전/종료 시 깨어난 직후 실행하도록 설정됨).
- CATECA는 결제 포털이라 자동 로그인 실패가 반복되면 계정 잠금 가능 → 비밀번호 변경 시 `.env` 갱신 필요.
- 로그인 방식: ID/비밀번호 (`#txtUserid` / `#txtPasswd` / `#btnLogin`), 캡차 없음.
