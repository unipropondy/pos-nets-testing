Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
Set oShortcut = WshShell.CreateShortcut(strDesktop & "\UniPro POS.lnk")
oShortcut.TargetPath = "wscript.exe"
oShortcut.Arguments = """" & WshShell.CurrentDirectory & "\UniPro-POS.vbs"""
oShortcut.WorkingDirectory = WshShell.CurrentDirectory
oShortcut.IconLocation = "shell32.dll,13"
oShortcut.Description = "UniPro Restaurant Point of Sale"
oShortcut.Save
WScript.Echo "Shortcut created successfully on Desktop!"
