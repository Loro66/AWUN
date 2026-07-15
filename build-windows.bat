@echo off
setlocal

where py >nul 2>nul || (echo Python launcher not found. Install Python 3.11+ first.& exit /b 1)
py -3.11 -m venv .venv-desktop
call .venv-desktop\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements-desktop.txt
pyinstaller --noconfirm --clean --onefile --windowed --name AWUN desktop\launcher.py
if errorlevel 1 exit /b 1

powershell -NoProfile -Command "$hash=(Get-FileHash 'dist\AWUN.exe' -Algorithm SHA256).Hash.ToLower(); Set-Content -Encoding ascii 'dist\AWUN.exe.sha256' ($hash + ' *AWUN.exe')"

echo AWUN.exe and its SHA256 checksum are ready in the dist folder.
pause
