@echo off
cd /d "%~dp0"
echo Naver Blog login (refresh session) - ALL blogs
echo  - A browser opens for each blog, one at a time.
echo  - Log in to Naver, then open the blog statistics screen.
echo  - It saves the session and closes, then opens the next blog.
node server/naver-blog-login.mjs --all
echo.
echo Done. Now run: 네이버블로그수집.bat
pause
