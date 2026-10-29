Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\siste\.gemini\antigravity\scratch\geo-panel"
WshShell.Run """C:\Program Files\nodejs\node.exe"" --watch ""C:\Users\siste\.gemini\antigravity\scratch\geo-panel\server.js""", 0, False
