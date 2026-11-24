import { MoonIcon, SunIcon } from "lucide-react";
import { notifyThemeSaveFailure } from "../../components/CommandPaletteThemeItems";
import { getThemeSnapshot, setAppearanceMode } from "../../hooks/useTheme";

// chronos(olympus): main-lxHaZZx7.js N01
export function dayNightButtonProps() {
  return {
    label: "День / ночь",
    onClick: () => {
      const { resolvedTheme } = getThemeSnapshot();
      if (!setAppearanceMode(resolvedTheme === "dark" ? "light" : "dark")) notifyThemeSaveFailure();
    },
    children: (
      <span className="olympus-mode-icon">
        <MoonIcon className="olympus-moon" />
        <SunIcon className="olympus-sun" />
        <style>
          {
            ".olympus-mode-icon{display:inline-flex}.olympus-mode-icon svg{width:16px;height:16px}.olympus-sun{display:none}.dark .olympus-sun{display:block}.dark .olympus-moon{display:none}"
          }
        </style>
      </span>
    ),
  };
}
