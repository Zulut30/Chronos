const net = require("node:net");
async function main() {
  if (!process.env.CHRONOS_PC_SOCKET || !process.env.CHRONOS_PC_KEY) throw new Error("Требуется локальная сессия Chronos.");
  let input = "";
  for await (const chunk of process.stdin.setEncoding("utf8")) {
    input += chunk;
    if (input.length > 32768) throw new Error("Слишком длинный запрос.");
  }
  const request = JSON.parse(input.replace(/^\uFEFF/, ""));
  const socket = net.connect(process.env.CHRONOS_PC_SOCKET);
  socket.on("error", () => { console.error("Управление ПК выключено или недоступно."); process.exitCode = 1; });
  socket.on("connect", () => socket.write(JSON.stringify({ key: process.env.CHRONOS_PC_KEY, request }) + "\n"));
  let result = "";
  socket.on("data", chunk => { result += chunk; });
  socket.on("end", () => {
    process.stdout.write(result);
    try { if (!JSON.parse(result).ok) process.exitCode = 1; }
    catch { process.exitCode = 1; }
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
