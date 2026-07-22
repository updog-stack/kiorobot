@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Marketing session refresh (Naver blog + Danggeun ads)
echo ------------------------------------------------------------
echo  The server collects using sessions exported from this PC.
echo  Danggeun sessions last about 11 days - rerun this then.
echo ============================================================
echo.

echo [1/2] Exporting sessions from local browser profiles...
node server/session-export.mjs
if errorlevel 1 (
  echo.
  echo  ^>^> Some sessions are missing or expired.
  echo     Log in again as shown above, then run this file once more.
  echo.
  pause
  exit /b 1
)

echo.
echo [2/2] Uploading to server...
scp server/data/naver-state.json server/data/naver-state-2.json server/data/daangn-state.json root@49.50.129.220:/root/kiorobot/dashboard/server/data/
if errorlevel 1 (
  echo.
  echo  ^>^> Upload failed. Check network / SSH key.
  echo.
  pause
  exit /b 1
)

echo.
echo  Done. The server will use the refreshed sessions on its next run.
echo    Naver    : 09:00 and 18:00 daily
echo    Danggeun : every hour, 09:00-21:00
echo.
pause
