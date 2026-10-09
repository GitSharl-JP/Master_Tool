@echo off
cd /d "%~dp0"
echo Construction de Atelier.exe ...
node launcher\build.mjs
if errorlevel 1 (
  echo.
  echo La construction a echoue : voir le message ci-dessus.
)
pause
