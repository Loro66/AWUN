@echo off
setlocal

where py >nul 2>nul || (echo Ne nayden Python Launcher. Ustanovite Python 3.11 ili novee.& exit /b 1)
py -3.11 -m venv .venv-desktop
call .venv-desktop\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements-desktop.txt
pyinstaller --noconfirm --clean AWUN.spec
if errorlevel 1 exit /b 1

powershell -NoProfile -Command "$hash=(Get-FileHash 'dist\SONGVALE.exe' -Algorithm SHA256).Hash.ToLower(); Set-Content -Encoding ascii 'dist\SONGVALE.exe.sha256' ($hash + ' *SONGVALE.exe')"
copy /Y LICENSE.md dist\LICENSE.md >nul
copy /Y EULA.md dist\EULA.md >nul

echo SONGVALE.exe, kontrolnaya summa i dokumenty gotovy v papke dist.
pause
