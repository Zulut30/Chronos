import { execFile } from "node:child_process";
import { posix } from "node:path";
import { promisify } from "node:util";
import { artifactTools as tools, quickstart } from "./tools.mjs";

export { quickstart };
const execute = promisify(execFile);

async function invoke(name, input, context) {
  if (name === "artifact_publish" && typeof input.source === "string" && posix.isAbsolute(input.source)) {
    const {stdout} = await execute("wslpath", ["-w", input.source]);
    input = {...input, source:stdout.trimEnd()};
  }
  const env = {...process.env, ELECTRON_RUN_AS_NODE:"1",
    WSLENV:[process.env.WSLENV,"ELECTRON_RUN_AS_NODE/w"].filter(Boolean).join(":")};
  const command = execute(process.env.CHRONOS_ARTIFACT_WINDOWS_NODE,
    [process.env.CHRONOS_ARTIFACT_WINDOWS_RUNNER, process.env.CHRONOS_ARTIFACT_WINDOWS_HOME],
    {env, windowsHide:true, timeout:30000, maxBuffer:128 * 1024 ** 2});
  command.child.stdin.on("error", () => {}); // Early host exits are reported by execFile.
  command.child.stdin.end(JSON.stringify({name,input,context}));
  const {stdout} = await command;
  const result = JSON.parse(stdout);
  if (result.error) throw Error(result.error);
  return result.value;
}

export const artifactTools = tools.map(tool => ({
  ...tool, run:(input,context) => invoke(tool.name,input,context),
}));
