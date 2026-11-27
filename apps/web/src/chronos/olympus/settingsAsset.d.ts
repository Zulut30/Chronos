declare module "chronos-olympus:settings" {
  export const mount: Parameters<typeof import("./settingsHost").openSettingsHost>[1];
}
