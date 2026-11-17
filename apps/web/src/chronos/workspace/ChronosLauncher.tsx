import styles from "./workspace.module.css";
import { useChronosWorkspace, type WorkspacePanel } from "./state";
import { localServicesAvailable } from "./services";

export function ChronosLauncher({
  panel = "tasks",
  label = "Chronos",
}: {
  panel?: WorkspacePanel;
  label?: string;
}) {
  const open = useChronosWorkspace((state) => state.open);
  if (!localServicesAvailable()) return null;
  return (
    <button type="button" className={styles["chronos-launcher"]} onClick={() => open(panel)}>
      {label}
    </button>
  );
}
