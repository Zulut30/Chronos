// @effect-diagnostics nodeBuiltinImport:off -- Reads the Antigravity 1.5 CLI sign-in token file and OS keyring synchronously.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

// chronos(olympus): runtimeLayer-ojyN-pY_.mjs N01
// Antigravity 1.5 keeps its Google sign-in in the OS keyring (`gemini:antigravity`) or in
// `antigravity-oauth-token`, never in acp_token.json. T3 cannot refresh it; agy renews it while running.

interface AntigravityCliToken {
  readonly access_token: string;
  readonly refresh_token?: string | undefined;
  readonly expiry?: string | undefined;
}

export interface AntigravityCliSignIn {
  readonly token: AntigravityCliToken;
  readonly email: string | undefined;
}

function olyDecodeGoKeyringSecret(bytes: ArrayLike<number>): string {
  const text = Buffer.from(bytes).toString("utf8");
  if (text.startsWith("go-keyring-base64:")) {
    return Buffer.from(text.slice(18), "base64").toString("utf8");
  }
  if (text.startsWith("go-keyring-encoded:")) {
    return Buffer.from(text.slice(19), "hex").toString("utf8");
  }
  return text;
}

function olyReadWindowsAntigravityCredential(
  architecture: NodeJS.Architecture,
): Buffer | undefined {
  if (architecture !== "x64" && architecture !== "arm64") return undefined;
  const { DataType, load, open } = NodeModule.createRequire(import.meta.url)(
    "ffi-rs",
  ) as typeof import("ffi-rs");
  open({
    library: "oly-advapi32",
    path: "advapi32.dll",
  });
  open({
    library: "oly-kernel32",
    path: "kernel32.dll",
  });
  const copy = (into: Buffer, from: bigint) =>
    load({
      library: "oly-kernel32",
      funcName: "RtlMoveMemory",
      retType: DataType.Void,
      paramsType: [DataType.U8Array, DataType.BigInt, DataType.BigInt],
      paramsValue: [into, from, BigInt(into.length)],
    });
  const out = Buffer.alloc(8);
  const read = load({
    library: "oly-advapi32",
    funcName: "CredReadW",
    retType: DataType.I32,
    paramsType: [DataType.WString, DataType.U32, DataType.U32, DataType.U8Array],
    paramsValue: ["gemini:antigravity", 1, 0, out],
  });
  if (read === 0) return undefined;
  const credential = out.readBigUInt64LE();
  try {
    const header = Buffer.alloc(48);
    copy(header, credential);
    const size = header.readUInt32LE(32);
    if (size === 0 || size > 65536) return undefined;
    const blob = Buffer.alloc(size);
    copy(blob, header.readBigUInt64LE(40));
    return blob;
  } finally {
    load({
      library: "oly-advapi32",
      funcName: "CredFree",
      retType: DataType.Void,
      paramsType: [DataType.BigInt],
      paramsValue: [credential],
    });
  }
}

/** `{ token, email }` from the CLI sign-in, or undefined when there is none or it cannot be read. */
export function olyReadAntigravityCliSignIn(
  cliTokenPath: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): AntigravityCliSignIn | undefined {
  let stored: string | undefined;
  try {
    if (NodeFS.existsSync(cliTokenPath)) {
      stored = NodeFS.readFileSync(cliTokenPath, "utf8");
    } else if (platform === "win32") {
      const secret = olyReadWindowsAntigravityCredential(architecture);
      stored = secret === undefined ? undefined : olyDecodeGoKeyringSecret(secret);
    } else if (platform === "darwin") {
      // go-keyring keeps it as the generic password service `gemini`, account `antigravity`.
      const { Entry } = NodeModule.createRequire(import.meta.url)(
        "@napi-rs/keyring",
      ) as typeof import("@napi-rs/keyring");
      const secret = new Entry("gemini", "antigravity").getSecret();
      stored = secret == null ? undefined : olyDecodeGoKeyringSecret(secret);
    }
    if (stored === undefined) return undefined;
    const parsed: unknown = JSON.parse(stored);
    const rawToken =
      parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).token
        : undefined;
    if (
      rawToken === null ||
      typeof rawToken !== "object" ||
      typeof (rawToken as Record<string, unknown>).access_token !== "string" ||
      !(rawToken as Record<string, unknown>).access_token
    ) {
      return undefined;
    }
    const tokenRecord = rawToken as Record<string, unknown>;
    const accessToken = tokenRecord.access_token as string;
    const email =
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>).id_token_email === "string"
        ? ((parsed as Record<string, unknown>).id_token_email as string)
        : undefined;
    return {
      token: {
        access_token: accessToken,
        refresh_token:
          typeof tokenRecord.refresh_token === "string" ? tokenRecord.refresh_token : undefined,
        expiry: typeof tokenRecord.expiry === "string" ? tokenRecord.expiry : undefined,
      },
      email,
    };
  } catch {
    return undefined;
  }
}
