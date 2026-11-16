' Starts the T3 files service (http://127.0.0.1:4519) without a console window.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\zulut\.t3\caches\t3-customizations\files-service"
sh.Run """C:\Program Files\nodejs\node.exe"" server.mjs", 0, False
