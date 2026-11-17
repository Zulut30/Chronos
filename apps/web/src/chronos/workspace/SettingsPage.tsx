import { useEffect } from "react";
import { useCloseAppModal } from "../../components/sidebar/mainAppLocation";
import type { AppRouter } from "../../router";
import { Link } from "@tanstack/react-router";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "../../components/ui/sidebar";
import {
  CHRONOS_SETTINGS_PATHS,
  WORKSPACE_PANELS,
  registerChronosSettingsNavigation,
} from "./state";
import { localServicesAvailable } from "./services";
import { ServiceFrame } from "./ChronosWorkspace";
import { IntegrationsPanel } from "./Panels";
import styles from "./workspace.module.css";

export function ChronosSettingsNavigation({ router }: { router: AppRouter }) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds launcher actions outside the router subtree to its native navigation
  useEffect(
    () =>
      registerChronosSettingsNavigation((panel) => {
        void router.navigate({ to: CHRONOS_SETTINGS_PATHS[panel] });
      }),
    [router],
  );
  return null;
}
export function ChronosSettingsNav() {
  return localServicesAvailable() ? (
    <SidebarGroup>
      <SidebarMenu>
        {Object.entries(CHRONOS_SETTINGS_PATHS).map(([panel, to]) => (
          <SidebarMenuItem key={panel}>
            <SidebarMenuButton size="sm" render={<Link to={to} data-settings-section={to} />}>
              {WORKSPACE_PANELS[panel as keyof typeof CHRONOS_SETTINGS_PATHS]}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  ) : null;
}
export function ChronosSettingsPage({ panel }: { panel: keyof typeof CHRONOS_SETTINGS_PATHS }) {
  const close = useCloseAppModal();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- routes the embedded service's Escape message through native Settings navigation
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        panel === "mcp" &&
        event.origin === "http://127.0.0.1:4523" &&
        event.data?.type === "oly-mcp-close"
      )
        void close();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [panel, close]);
  if (!localServicesAvailable())
    return <p>Откройте Chronos на компьютере с локальными сервисами.</p>;
  return (
    <section className={styles["chronos-settings-page"]} aria-label={WORKSPACE_PANELS[panel]}>
      {panel === "integrations" ? <IntegrationsPanel /> : <ServiceFrame service={panel} />}
    </section>
  );
}
