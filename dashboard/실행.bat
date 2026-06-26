@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 다인아이앤씨 ERP 대시보드

echo ============================================
echo   다인아이앤씨 ERP 대시보드 실행
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 가 설치되어 있지 않습니다.
  echo.
  echo   1^) https://nodejs.org 접속
  echo   2^) LTS 버전 다운로드 후 설치
  echo   3^) 설치가 끝나면 이 파일을 다시 더블클릭하세요.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] 최초 실행 - 필요한 패키지를 설치합니다. ^(인터넷 필요, 수 분 소요^)
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [오류] 패키지 설치에 실패했습니다. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
  )
  echo.
)

REM ── 데이터 API 서버(BFF) : 별도 창에서 실행 (포트 8787) ──
if exist ".env" (
  echo [2/3] 데이터 API 서버^(BFF^)를 새 창에서 시작합니다... ^(포트 8787^)
  start "ERP - 데이터 API (BFF)" cmd /k "chcp 65001 >nul & node server/notion-sales-bff.mjs"
) else (
  echo [2/3] .env 파일이 없어 데이터 API^(BFF^)는 건너뜁니다.
  echo        전체 현황 탭은 정상 동작합니다. ^(TR/매출/CS 등 외부연동 탭은 비어 보일 수 있음^)
)
echo.

echo [3/3] 화면 서버를 시작합니다...
echo.
echo   ^>^>  브라우저에서  http://localhost:5173  로 접속하세요.
echo   ^>^>  종료하려면 이 창에서 Ctrl + C, 그리고 'BFF' 창도 닫으세요.
echo.

start "" http://localhost:5173
call npm run dev

pause
