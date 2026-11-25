require("./compileCache.cjs");
// chronos: shortcuts bypass the application runtime, providers and Studio sidecars.
if (process.argv.some(arg => arg.startsWith("--chronos-artifact="))) {
  require(require("node:path").join(process.resourcesPath,"chronos-services","artifacts","standalone.cjs")).start(process.argv);
} else {
  require("./main.cjs");
}
