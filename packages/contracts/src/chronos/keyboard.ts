export interface KeyboardAction {
  id: string;
  arg?: string;
}
export interface KeyboardProfile {
  version: 2;
  id: string;
  name: string;
  bindings: Record<
    string,
    { signal: string | null; action: KeyboardAction | null }
  >;
}
export interface KeyboardSnapshot {
  enabled: boolean;
  device: string | null;
  devices: string[];
  profiles: { id: string; name: string }[];
  current: KeyboardProfile;
  actions: Record<string, string>;
  revision: string;
  status: string;
  last: string | null;
  learning: string | null;
}
export type KeyboardEventMessage =
  | { type: "action"; data: KeyboardAction }
  | { type: "signal" | "status" | "learned" | "error"; data: string }
  | { type: "devices"; data: null };
export interface KeyboardBridge {
  request(op: "proposal"): Promise<{ profile: KeyboardProfile; base: string }>;
  request(
    op:
      | "open"
      | "refresh"
      | "snapshot"
      | "enable"
      | "device"
      | "activate"
      | "create"
      | "rename"
      | "delete"
      | "learn"
      | "cancel"
      | "save",
    payload?: unknown,
  ): Promise<KeyboardSnapshot>;
  request(op: "close"): Promise<null>;
  subscribe(listener: (event: KeyboardEventMessage) => void): () => void;
}
