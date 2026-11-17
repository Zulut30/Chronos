// chronos: reuse the local skills manager inside native Settings.
import { createFileRoute } from "@tanstack/react-router";
import { ChronosSettingsPage } from "../chronos/workspace/SettingsPage";
export const Route = createFileRoute("/_chat/settings/skills")({
  component: () => <ChronosSettingsPage panel="skills" />,
});
