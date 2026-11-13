#define MyAppName "Smart POS"
#define MyAppVersion "3.0.0"
#define MyAppPublisher "Smart POS"
#define MyAppURL "https://unipro.com"
#define MyAppExeName "SmartPOS.exe"

[Setup]
AppId={{9F3B1A2C-4E5D-6F7A-8B9C-0D1E2F3A4B5C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\installer-output
OutputBaseFilename=SmartPOS-Setup
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Dirs]
; Automatically create the logs directory with full user permissions
Name: "{app}\logs"; Permissions: users-full

[Files]
; Launcher and Node runtime
Source: "..\installer-build\SmartPOS.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "C:\Program Files\nodejs\node.exe"; DestDir: "{app}"; Flags: ignoreversion

; Entire backend runtime and frontend build in backend/dist
Source: "..\backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".git\*,.cache\*,logs\*"

; Automatically include initial logs in {app}\logs
Source: "..\logs\backend.log"; DestDir: "{app}\logs"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\logs\frontend.log"; DestDir: "{app}\logs"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autoprograms}\{#MyAppName} Logs"; Filename: "{win}\explorer.exe"; Parameters: """{app}\logs"""
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{autodesktop}\{#MyAppName} Logs"; Filename: "{win}\explorer.exe"; Parameters: """{app}\logs"""; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
