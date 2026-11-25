import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

// chronos: load the macro pad editor when its settings section opens.
export const Route = createFileRoute("/_chat/settings/keyboards")({
  component: lazyRouteComponent(
    () => import("../chronos/keyboard/KeyboardPanel"),
    "KeyboardPanel",
  ),
});
