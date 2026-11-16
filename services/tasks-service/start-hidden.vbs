' Starts the T3 tasks service (http://127.0.0.1:4518) without a console window. Data: %USERPROFILE%\.t3\tasks
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\zulut\.t3\caches\t3-customizations\tasks-service"
sh.Run """C:\Program Files\nodejs\node.exe"" server.mjs", 0, False
