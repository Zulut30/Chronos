import { useGT, useLocale } from "gt-react";
import { useEffect, useState } from "react";
import { desktopError } from "../desktopError";

export type Mode = "every" | "risk" | "none";
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
export interface State {
  settings: Settings;
  active: boolean;
  pending: Approval[];
  history: { id: string; time: number; op: string; status: string }[];
}
declare global {
  interface Window {
    chronosPC?: {
      settings(input: unknown): Promise<State>;
      subscribe(listener: () => void): () => void;
    };
  }
}
export function useControl() {
  const gt = useGT();
  const locale = useLocale();
  const [state, setState] = useState<State>();
  const [readError, setReadError] = useState<Error>();
  const [writeError, setWriteError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribe to changes from the desktop permission broker.
  useEffect(() => {
    if (!window.chronosPC) return;
    const api = window.chronosPC;
    let generation = 0;
    function refresh() {
      const id = ++generation;
      void api.settings({ op: "state" }).then(
        (value) => {
          if (id !== generation) return;
          setState(value);
          setReadError(undefined);
        },
        (cause: Error) => {
          if (id === generation) setReadError(cause);
        },
      );
    }
    const remove = api.subscribe(refresh);
    refresh();
    return () => {
      generation++;
      remove();
    };
  }, [attempt]);

  async function send(input: unknown) {
    try {
      await window.chronosPC?.settings(input);
      setWriteError(undefined);
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
  const cause = writeError ?? readError;
  const fallback = writeError
    ? gt("Could not complete the computer control action.")
    : gt("Could not load computer control settings.");
  const error = cause && (locale.startsWith("ru") ? desktopError(cause, fallback) : fallback);
  return {
    state,
    send,
    error,
    retry: () => {
      setWriteError(undefined);
      setAttempt((previous) => previous + 1);
    },
  };
}
