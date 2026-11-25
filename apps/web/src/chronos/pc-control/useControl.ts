import { useEffect, useState } from "react";

type Mode = "every" | "risk" | "none";
export interface Settings {
  enabled: boolean;
  all: boolean;
  mode: Mode;
  apps: string[];
}
export interface Approval {
  id: string;
  op: string;
  target: string;
  label: string;
  manual: boolean;
  proposal?: string;
}
interface State {
  settings: Settings;
  active: boolean;
  pending: Approval[];
  history: { time: number; op: string; status: string }[];
}
declare global {
  interface Window {
    chronosPC?: {
      settings(input: unknown): Promise<State>;
      subscribe(listener: () => void): () => void;
    };
  }
}
export const labels: Record<string, string> = {
  open: "Открыть",
  attach: "Подключиться",
  snapshot: "Снимок",
  windows: "Список окон",
  save: "Сохранить временный документ",
  expand: "Раскрыть меню",
  click: "Нажать",
  fill: "Заполнить поле",
  close: "Завершить сессию",
  stop: "Аварийная остановка",
};
function subscribeToControl(setState: (state: State) => void) {
  const api = window.chronosPC;
  if (!api) return;
  let generation = 0;
  function refresh() {
    generation = generation + 1;
    const id = generation;
    void api
      ?.settings({ op: "state" })
      .then((value) => {
        if (id === generation) setState(value);
      })
      .catch(() => {});
  }
  const remove = api.subscribe(refresh);
  refresh();
  return () => {
    generation = generation + 1;
    remove();
  };
}

export function useControl() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  useEffect(() => subscribeToControl(setState), []);
  async function send(input: unknown) {
    try {
      await window.chronosPC?.settings(input);
      setError("");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }
  return { state, send, error };
}
