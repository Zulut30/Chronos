import styles from "./workspace.module.css";
import { lazy, Suspense, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useRenderedAppearance } from "../../hooks/useTheme";
import { useChronosWorkspace, WORKSPACE_PANELS, type WorkspacePanel } from "./state";
import { LOCAL_SERVICES, serviceFrameUrl, localServicesAvailable } from "./services";
import { ChronosStudioBridge } from "./ChronosComposer";
import { useServiceData } from "./useServiceData";

const TaskBoard = lazy(() =>
  import("./TaskBoard").then((module) => ({ default: module.TaskBoard })),
);
const OpenRouterPanel = lazy(() =>
  import("./Panels").then((module) => ({ default: module.OpenRouterPanel })),
);
const MachinesPanel = lazy(() =>
  import("./Panels").then((module) => ({ default: module.MachinesPanel })),
);
const FilesPanel = lazy(() =>
  import("./Panels").then((module) => ({ default: module.FilesPanel })),
);
const SpeedPanel = lazy(() =>
  import("./ChronosComposer").then((module) => ({ default: module.SpeedPanel })),
);
const StudioPanel = lazy(() =>
  import("./StudioPanel").then((module) => ({ default: module.StudioPanel })),
);

export function ServiceFrame({
  service,
  path = "/",
}: {
  service: "skills" | "studio" | "mcp";
  path?: string;
}) {
  const appearance = useRenderedAppearance();
  const [src] = useState(() => serviceFrameUrl(service, path, appearance));
  const health = useServiceData<{ ok: boolean }>(service, LOCAL_SERVICES[service].health);
  return (
    <div className={styles["chronos-service-frame"]}>
      {health.error ? (
        <div role="alert">
          <p>{health.error}</p>
          <p>
            Нужен запущенный существующий сервис {LOCAL_SERVICES[service].label} на порту{" "}
            {LOCAL_SERVICES[service].port}.
          </p>
          <button onClick={health.refresh}>Повторить</button>
        </div>
      ) : (
        <>
          {!health.value && <p role="status">Подключение к сервису…</p>}

          <iframe
            title={LOCAL_SERVICES[service].label}
            src={src}
            // oxlint-disable-next-line react/iframe-missing-sandbox -- trusted cross-origin local apps require their own origin for API calls
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"
          />
        </>
      )}
    </div>
  );
}

function Panel({ panel }: { panel: WorkspacePanel }) {
  if (panel === "tasks") return <TaskBoard />;
  if (panel === "skills" || panel === "mcp" || panel === "integrations") return null;
  if (panel === "studio") return <StudioPanel />;
  if (panel === "files") return <FilesPanel />;
  if (panel === "machines") return <MachinesPanel />;
  if (panel === "openrouter") return <OpenRouterPanel />;
  return <SpeedPanel />;
}

export function ChronosWorkspace() {
  const { panel, open, close } = useChronosWorkspace();
  if (!localServicesAvailable()) return null;
  return (
    <>
      <ChronosStudioBridge />
      <Dialog.Root
        open={panel !== null}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={styles["chronos-backdrop"]} />
          <Dialog.Popup className={styles["chronos-workspace"]}>
            <header>
              <Dialog.Title>{panel ? WORKSPACE_PANELS[panel] : "Chronos"}</Dialog.Title>
              <Dialog.Close className={styles["chronos-launcher"]}>Закрыть</Dialog.Close>
            </header>
            <div className={styles["chronos-workspace-layout"]}>
              <nav aria-label="Расширения Chronos">
                {Object.entries(WORKSPACE_PANELS).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={panel === id ? "page" : undefined}
                    onClick={() => open(id as WorkspacePanel)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <main>
                <Suspense fallback={<p>Загрузка…</p>}>
                  {panel && <Panel key={panel} panel={panel} />}
                </Suspense>
              </main>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
