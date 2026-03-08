@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0vn"

set INK="C:\Users\alees\OneDrive\Desktop\tools\ink\inklecate.exe"

echo =========================
echo   Compiling ALL chapters
echo =========================
echo.

for /r %%f in (*.ink) do (
  set input=%%f
  set output=%%~dpfstory.json

  echo [IN]  %%f
  echo [OUT] !output!

  %INK% -o "!output!" "!input!"

  if exist "!output!" (
    echo [OK]  story.json written.
  ) else (
    echo [FAIL] story.json was NOT created. Check inklecate path or ink errors.
  )
  echo.
)

echo Done compiling everything.
pause
