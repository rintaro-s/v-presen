@echo off
chcp 65001 >nul
rem Arsist ScreenCast を起動する。引数はそのまま渡す (例: start.bat --headless --source screen:0 --name slides)
set "HERE=%~dp0"
set "ELECTRON=%HERE%..\..\node_modules\.bin\electron.cmd"
if not exist "%ELECTRON%" (
  where electron >nul 2>nul || (
    echo Electron が見つかりません。リポジトリの直下で npm install してください。
    exit /b 1
  )
  set "ELECTRON=electron"
)
"%ELECTRON%" "%HERE%." %*
