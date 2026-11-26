// Applied after pnpm has installed the patched runtime dependencies.
export const windowsPayloadExclusions = [
  "patches",
  "patches/**",
  "**/*.pdb",
  "**/node_modules/node-pty/prebuilds/{linux,darwin}-*/**",
  "**/node_modules/@yuuang/ffi-rs-win32-ia32-msvc/**",
] as const;
