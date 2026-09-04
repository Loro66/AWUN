#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
AppId={{933AB339-8AAF-4AB4-A2C3-911612F9A5B7}
AppName=AWUN
AppVersion={#MyAppVersion}
AppPublisher=Loro66
AppPublisherURL=https://github.com/Loro66/AWUN
AppSupportURL=https://github.com/Loro66/AWUN/issues
AppUpdatesURL=https://github.com/Loro66/AWUN/releases
DefaultDirName={localappdata}\Programs\AWUN
DefaultGroupName=AWUN
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=AWUN-Setup-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\desktop\assets\awun.ico
UninstallDisplayIcon={app}\AWUN.exe
CloseApplications=yes
RestartApplications=no
LicenseFile=..\EULA.md

[Files]
Source: "..\dist\AWUN.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\EULA.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\AWUN"; Filename: "{app}\AWUN.exe"
Name: "{autodesktop}\AWUN"; Filename: "{app}\AWUN.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные ярлыки:"; Flags: unchecked

[Run]
Filename: "{app}\AWUN.exe"; Description: "Запустить AWUN"; Flags: nowait postinstall skipifsilent
