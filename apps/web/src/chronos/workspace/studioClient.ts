import { randomUUID } from "../../lib/utils";
let client: string | undefined;
export function studioClientId() {
  if (client) return client;
  client = sessionStorage.getItem("chronos-studio-client") ?? randomUUID();
  sessionStorage.setItem("chronos-studio-client", client);
  return client;
}
