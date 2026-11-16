' Starts the T3 skills manager service (http://127.0.0.1:4517) without a console window.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\zulut\.t3\caches\t3-customizations\skills-manager"
sh.Run """C:\Program Files\nodejs\node.exe"" server.mjs", 0, False
