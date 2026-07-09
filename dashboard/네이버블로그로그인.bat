@echo off
cd /d "%~dp0"
echo Naver Blog login (refresh session)
echo  - A browser opens. Log in to Naver, then open the blog statistics screen.
echo  - It saves the session and closes.
node server/naver-blog-login.mjs
echo.
echo Done. Now run: 네이버블로그수집.bat
pause
