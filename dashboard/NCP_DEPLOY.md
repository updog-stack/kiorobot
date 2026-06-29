# 네이버 클라우드(NCP) 배포 가이드

이 ERP를 네이버 클라우드 서버 1대에 올려 24시간 운영하는 **단계별 가이드**입니다.
앱이 **서버 1개·포트 1개(8787)에서 화면+API를 모두 제공**하도록 만들어, 구성을 최대한 단순화했습니다.

> ⚠️ 이 단계(리눅스 서버·SSH·명령어)는 지금까지 중 가장 기술적인 부분입니다. 막히면 그 화면을 캡처해 알려주시면 단계마다 안내하겠습니다.

---

## 0. 최종 구성 (그림)

```
[사용자 브라우저] ──HTTPS──> [도메인 erp.daininc.kr]
                                  │
                         [NCP 서버(Ubuntu)]
                           ├─ Caddy : HTTPS 자동발급 + 8787로 전달
                           ├─ Node(PM2) : ERP 서버(화면+API+로그인) :8787
                           └─ cron : 매일 08:00 수집(daily-collect)

  ※ 로그인(접근제어)은 앱에 내장됨 — .env 의 APP_PASSWORD 로 동작.
    (로그인 화면 → 세션 쿠키 → /api/* 보호. Caddy 는 HTTPS·전달만 담당.)
```

---

## 1. NCP 가입 · 결제수단 등록
1. https://www.ncloud.com 가입 → 콘솔 로그인
2. **마이페이지 → 결제수단**에 카드 등록 (서버는 시간당 과금)

## 2. 서버 생성
1. 콘솔 → **Services → Compute → Server** → **서버 생성**
2. 설정:
   - 이미지: **Ubuntu 22.04 (LTS)**
   - 서버 타입: **2vCPU / 4GB**(예: Standard 또는 Compact g2) — 5인 사내용 충분
   - 스토리지: 기본(50GB SSD)
   - 요금제: **시간 요금제**
   - 이름: 예) `erp-server`
3. **인증키**: "새 인증키 생성" → 이름 입력 → **.pem 파일 다운로드**(잘 보관! 비밀번호 확인용)
4. 생성 완료까지 5~10분

## 3. 공인 IP 할당
1. 콘솔 → **Server → 공인 IP** → **공인 IP 신청** → 방금 만든 서버에 할당
2. 할당된 IP(예: `223.130.x.x`)를 메모 → **인터넷에서 접속할 주소**

## 4. 방화벽(ACG) 포트 열기
1. 콘솔 → **Server → ACG** → 서버의 ACG 선택 → **규칙 설정**
2. **인바운드 규칙** 추가:
   | 프로토콜 | 포트 | 접근 소스 | 용도 |
   |---|---|---|---|
   | TCP | 22 | **내 사무실 IP/32** | SSH 접속(보안상 내 IP만) |
   | TCP | 80 | 0.0.0.0/0 | HTTP→HTTPS 리디렉션 |
   | TCP | 443 | 0.0.0.0/0 | HTTPS(실제 접속) |
   > 8787은 외부에 열지 않습니다(Caddy가 내부에서 전달). SSH(22)는 가능하면 사무실 고정 IP만 허용.

## 5. 서버 접속(SSH)
1. 콘솔 → 서버 → **관리자 비밀번호 확인** → 2번에서 받은 **.pem 업로드** → 비밀번호 확인·복사
2. Windows에서 **PowerShell/터미널**:
   ```bash
   ssh root@<공인IP>      # 비밀번호 입력(위에서 복사한 것)
   ```
   (처음 접속 시 yes 입력)

## 6. 설치 · 배포
서버에 접속한 상태에서 차례로:

```bash
# 1) 기본 패키지 + Node 22
apt update && apt -y upgrade
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 22

# 2) 코드 받기 (GitHub Private 저장소 → 토큰(PAT) 필요)
git clone https://github.com/<계정>/dain-erp-dashboard.git
cd dain-erp-dashboard

# 3) 설치 + 스크래퍼용 브라우저(+리눅스 의존성)
npm install
npx playwright install --with-deps chromium

# 4) 비밀키 입력 (운영용으로 재발급한 새 키!)
cp .env.example .env
nano .env        # 모든 키 채우기 → Ctrl+O 저장, Ctrl+X 종료
#   ⚠️ 외부 오픈이므로 반드시 채울 것:
#     APP_PASSWORD   = 대시보드 접속 비밀번호(전 직원 공용)
#     SESSION_SECRET = 아무 긴 무작위 문자열. 아래로 생성해 붙여넣기:
#       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 5) 화면 빌드
npm run build

# 6) 상시 실행(PM2)
npm i -g pm2
pm2 start server/notion-sales-bff.mjs --name erp
pm2 save && pm2 startup     # 출력되는 명령 한 줄 복사해 실행(재부팅 자동복구)

# 7) 매일 08:00 자동 수집(cron)
crontab -e
#   맨 아래 추가(경로 확인):
#   0 8 * * * cd /root/dain-erp-dashboard && /root/.nvm/versions/node/v22*/bin/node server/daily-collect.mjs >> /root/collect.log 2>&1
```

이 시점에서 서버 내부 `http://localhost:8787` 로 화면+API가 동작합니다(아직 외부 도메인/HTTPS 전).

## 7. 도메인 연결 + HTTPS (Caddy)
> Caddy = HTTPS 자동발급 + 리버스프록시. **로그인은 앱에 내장**(6단계 `APP_PASSWORD`)되어 있어 Caddy 설정은 두 줄로 끝납니다.

1. 도메인 준비: 가비아 등에서 도메인 구입 → DNS A레코드 `erp.daininc.kr → 공인IP`
2. Caddy 설치:
   ```bash
   apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
   apt update && apt install -y caddy
   ```
3. `/etc/caddy/Caddyfile` 작성(`nano /etc/caddy/Caddyfile`):
   ```
   erp.daininc.kr {
       reverse_proxy localhost:8787
   }
   ```
4. 적용: `systemctl reload caddy`
5. 브라우저에서 **https://erp.daininc.kr** → **로그인 화면**에 `APP_PASSWORD` 입력 → 대시보드 ✅
   - HTTPS 인증서는 Caddy가 자동 발급/갱신합니다.
   - 로그인하면 7일간 세션이 유지되고, 우측 상단 **로그아웃** 버튼으로 종료할 수 있습니다.

> 이렇게 하면 **인터넷에 열려도 로그인 없이는 못 봅니다.** (master.md의 접근제어 요건 충족)
> Caddy `basic_auth` 대신 앱 로그인을 쓰는 이유: 로그아웃·세션 만료·로그인 화면 UX가 앱 안에서 일관되게 동작하고, 호스팅(Caddy/Nginx/직접서빙) 방식과 무관하게 보호되기 때문입니다.

## 8. 업데이트(코드 바꿀 때마다)
```bash
cd /root/dain-erp-dashboard
git pull
npm install        # 의존성 바뀌었을 때만
npm run build
pm2 restart erp
```

## 9. NCP 비용(대략)
| 항목 | 월 비용(대략) |
|---|---|
| 서버 2vCPU/4GB (시간요금) | ₩4만 ~ 9만 |
| 공인 IP | ₩수천 |
| 도메인 | 월 ₩1~2천(연 결제) |
| HTTPS | 무료(Caddy) |
| **합계** | **월 약 ₩5만 ~ 9만** |

> 더 저렴하게: NCP "Compact/Micro" 더 작은 사양이나 시간요금 최적화. 다만 Playwright 때문에 RAM 4GB 권장.

---

## 운영 팁
- **로그 확인**: `pm2 logs erp`, 수집 로그 `tail -f /root/collect.log`
- **수동 수집 한 번**: `cd ~/dain-erp-dashboard && node server/daily-collect.mjs`
- **2차 인증(다우데이타)**: 서버(새 IP)에서 첫 로그인 시 채널/VAN사가 추가 인증을 요구할 수 있음 → Gmail IMAP으로 자동 처리되지만 최초 1회 모니터링 권장.
- **백업**: `server/data/*.json` 과 `.env` 주기 백업.
- **데이터 보관**: 매출·사업자번호 등은 국내 서버(NCP)에 보관 → 데이터 국내화 측면에서도 적절.

막히는 단계가 있으면 그 화면을 캡처해 주세요. 한 단계씩 같이 진행하겠습니다.
