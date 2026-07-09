@echo off
cd /d "%~dp0"
echo ==================================================
echo   Danggeun (Karrot) Ads Collector
echo ==================================================
echo  1) A browser window opens. Log in to Danggeun Biz.
echo  2) It refreshes ad stats every 30 minutes.
echo  3) KEEP this window and the browser OPEN.
echo     If you close them, you must run this again + re-login.
echo ==================================================
echo.
node server/daangn-ads-daemon.mjs
echo.
echo (Collector stopped. Double-click this file to restart.)
pause
