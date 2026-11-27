// Started on demand by the local desktop WSL backend using its own Windows Electron executable.
import { artifactTools } from "./tools.mjs";

try {
  process.env.CHRONOS_SERVICES_DATA = process.argv[2];
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const {name,input,context} = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const tool = artifactTools.find(entry => entry.name === name);
  if (!tool) throw Error("Неизвестное действие Студии");
  const value = await tool.run(input,context);
  process.stdout.write(JSON.stringify({value}));
} catch (e) {
  process.stdout.write(JSON.stringify({error:e.message}));
}
