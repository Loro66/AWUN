@echo off
setlocal

where py >nul 2>nul || (echo Ne nayden Python Launcher. Ustanovite Python 3.11 ili novee.& exit /b 1)
py -3.11 -m venv .venv-desktop
call .venv-desktop\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements-desktop.txt
pyinstaller --noconfirm --clean AWUN.spec
if errorlevel 1 exit /b 1

powershell -NoProfile -Command "$hash=(Get-FileHash 'dist\AWUN.exe' -Algorithm SHA256).Hash.ToLower(); Set-Content -Encoding ascii 'dist\AWUN.exe.sha256' ($hash + ' *AWUN.exe')"
copy /Y LICENSE.md dist\LICENSE.md >nul
copy /Y EULA.md dist\EULA.md >nul

echo AWUN.exe, kontrolnaya summa i dokumenty gotovy v papke dist.
pause
