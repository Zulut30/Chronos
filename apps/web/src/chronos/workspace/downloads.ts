import type { EnvironmentId } from "@t3tools/contracts";
import { readPreparedConnection } from "../../state/session";
import { localServicesAvailable, serviceRequest } from "./services";
import { useChronosWorkspace } from "./state";

export function chronosDownloadItems() {
  return localServicesAvailable()
    ? [{ id: "chronos-download", label: "Скачать на этот компьютер" }]
    : [];
}
export async function beginChronosDownload(
  target: { environmentId: EnvironmentId; filePath: string; workspaceRoot: string },
  isDir: boolean,
) {
  useDownloadJobs.setState({ error: "" });
  try {
    const health = await serviceRequest<{ localEnvId: string }>("files", "/health");
    const root = target.workspaceRoot.replace(/[\\/]$/, "");
    const path = `${root}/${target.filePath}`;
    const connection = readPreparedConnection(target.environmentId);
    const local = health.localEnvId === target.environmentId;
    if (!local && !connection) throw Error("Окружение отключено. Подключите его перед загрузкой.");
    const job = await serviceRequest<DownloadJob>("files", local ? "/local" : "/ssh", {
      body: local
        ? { envId: target.environmentId, path, isDir }
        : { httpBase: connection!.httpBaseUrl, path, isDir },
    });
    useDownloadJobs.setState((state) => ({ jobs: [...state.jobs, job] }));
  } catch (reason) {
    useDownloadJobs.setState({ error: String(reason) });
  }
  useChronosWorkspace.getState().open("files");
}

import { create } from "zustand";
export interface DownloadJob {
  id: string;
  state: string;
  name: string;
  bytes: number;
  path: string;
  error: string;
  filesDone: number;
  files: number;
}
export const useDownloadJobs = create<{
  jobs: DownloadJob[];
  error: string;
  setJobs: (jobs: DownloadJob[] | ((current: DownloadJob[]) => DownloadJob[])) => void;
}>((set) => ({
  jobs: [],
  error: "",
  setJobs: (jobs) =>
    set((state) => ({ jobs: typeof jobs === "function" ? jobs(state.jobs) : jobs })),
}));
