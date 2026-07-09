@echo off
cd /d "%~dp0"
echo Naver Blog view-count collector
echo  - A browser window opens briefly, collects view stats, then closes.
echo  - Uses the saved login session (no re-login unless expired).
node server/naver-blog-scraper.mjs
echo.
echo Done. If it says session expired, run: naver-blog-login.bat
pause
