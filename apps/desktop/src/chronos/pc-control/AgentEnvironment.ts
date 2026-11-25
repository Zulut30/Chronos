let environment: Readonly<Record<string, string>> = {};

export const pcAgentEnvironment = () => environment;
export function setPcAgentEnvironment(next: Readonly<Record<string, string>>) {
  environment = next;
}
