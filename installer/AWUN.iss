#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
AppId={{933AB339-8AAF-4AB4-A2C3-911612F9A5B7}
AppName=SONGVALE
AppVersion={#MyAppVersion}
AppPublisher=Loro66
AppPublisherURL=https://github.com/Loro66/AWUN
AppSupportURL=https://github.com/Loro66/AWUN/issues
AppUpdatesURL=https://github.com/Loro66/AWUN/releases
DefaultDirName={localappdata}\Programs\SONGVALE
DefaultGroupName=SONGVALE
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=SONGVALE-Setup-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\desktop\assets\songvale.ico
UninstallDisplayIcon={app}\SONGVALE.exe
CloseApplications=yes
RestartApplications=no
LicenseFile=..\EULA.md

[Files]
Source: "..\dist\SONGVALE.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\EULA.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\SONGVALE"; Filename: "{app}\SONGVALE.exe"
Name: "{autodesktop}\SONGVALE"; Filename: "{app}\SONGVALE.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные ярлыки:"; Flags: unchecked

[Run]
Filename: "{app}\SONGVALE.exe"; Description: "Запустить SONGVALE"; Flags: nowait postinstall skipifsilent
