@echo off
cd /d "%~dp0"
echo Construction de l'installateur (quelques minutes : ffmpeg est volumineux) ...
node installer\build.mjs
if errorlevel 1 (
  echo.
  echo La construction a echoue : voir le message ci-dessus.
)
pause
