// This function is evaluated inside the offline fixture page. Only its result leaves the renderer.
function rehearsalPreferences(storage) {
  const themeId = value => typeof value === "string" && /^[a-z0-9][a-z0-9.:-]{0,127}$/i.test(value);
  return Object.entries(storage).filter(([key, value]) => {
    if (/^(oly-plan-v2:|oly-machines-aliases$|oly-speed-v[234]$|oly-studio-client(?:-id)?$)/.test(key)) return true;
    if (key === "t3code:theme") return themeId(value);
    if (key === "t3code:theme-appearance-mode") return ["system", "light", "dark"].includes(value);
    if (key === "t3code:theme-follow-system") return ["true", "false", "1", "0"].includes(value);
    if (/^chronos\.olympus\.\d{2}-[a-z0-9-]+$/.test(key)) return value === "0" || value === "1";
    if (key !== "t3code:theme-halves:v1") return false;
    try {
      const halves = JSON.parse(value);
      return halves !== null && typeof halves === "object" && !Array.isArray(halves) &&
        Object.entries(halves).every(([side, id]) => (side === "light" || side === "dark") && themeId(id));
    } catch {
      return false;
    }
  });
}
module.exports = { rehearsalPreferences };
