@echo off
setlocal

py -3.11 -m venv .venv-desktop
call .venv-desktop\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements-desktop.txt
pyinstaller --noconfirm --clean --onefile --windowed --name AWUN desktop\launcher.py

echo.
echo AWUN.exe is ready in the dist folder.
pause

