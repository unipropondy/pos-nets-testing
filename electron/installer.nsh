!macro customInstall
  ; Standardized persistent log directory for Smart POS across all users and services: C:\ProgramData\SmartPOS\logs
  CreateDirectory "$APPDATA\..\..\ProgramData\SmartPOS\logs"
  
  ; Ensure Desktop and Start Menu shortcuts open the correct persistent log folder
  CreateShortCut "$DESKTOP\Smart POS Logs.lnk" "$WINDIR\explorer.exe" '"$APPDATA\..\..\ProgramData\SmartPOS\logs"' "" "" "" "" "Open Smart POS Logs Folder"
  CreateShortCut "$SMPROGRAMS\Smart POS\Smart POS Logs.lnk" "$WINDIR\explorer.exe" '"$APPDATA\..\..\ProgramData\SmartPOS\logs"' "" "" "" "" "Open Smart POS Logs Folder"
  
  ; Clean up legacy UniPro shortcuts if present
  Delete "$DESKTOP\UniPro POS Logs.lnk"
  Delete "$SMPROGRAMS\UniPro POS\UniPro POS Logs.lnk"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Smart POS Logs.lnk"
  Delete "$SMPROGRAMS\Smart POS\Smart POS Logs.lnk"
  Delete "$DESKTOP\UniPro POS Logs.lnk"
  Delete "$SMPROGRAMS\UniPro POS\UniPro POS Logs.lnk"
!macroend
