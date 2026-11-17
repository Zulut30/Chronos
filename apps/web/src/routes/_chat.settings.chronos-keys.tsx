// chronos: local API keys use the existing service without replacing browser integrations.
import { createFileRoute } from "@tanstack/react-router";
import { ChronosSettingsPage } from "../chronos/workspace/SettingsPage";
export const Route = createFileRoute("/_chat/settings/chronos-keys")({
  component: () => <ChronosSettingsPage panel="integrations" />,
});
