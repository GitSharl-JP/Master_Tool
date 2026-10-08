@echo off
cd /d "%~dp0"
if "%~1"=="" (
  echo Glissez le fichier de sauvegarde .zip sur ce fichier, ou lancez : Restaurer.bat chemin\sauvegarde.zip
  pause
  exit /b 1
)
node --disable-warning=ExperimentalWarning srcestore.js "%~1" %2 %3
pause
