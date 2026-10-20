@echo off
rem ABW Arcade - Installation und Update unter Windows.
rem Startet install.ps1 und reicht alle Argumente durch, zum Beispiel:
rem     install.cmd
rem     install.cmd -Port 8080
rem     install.cmd -Uninstall
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
