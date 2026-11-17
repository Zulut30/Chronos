// chronos: the existing Settings layout owns the only modal and navigation.
import { createFileRoute } from "@tanstack/react-router";
import { ChronosSettingsPage } from "../chronos/workspace/SettingsPage";
export const Route = createFileRoute("/_chat/settings/mcp")({
  component: () => <ChronosSettingsPage panel="mcp" />,
});
