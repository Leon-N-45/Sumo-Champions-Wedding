@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Sumo-Champions Wedding
echo  Update local data from the spreadsheet
echo ============================================
echo.
node tools\build_data.js
echo.
if errorlevel 1 (
  echo [FAILED] See the message above.
) else (
  echo [DONE] Reload the game in your browser.
)
echo.
pause
