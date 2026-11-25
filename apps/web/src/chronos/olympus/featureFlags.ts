// Only independent modules and explicitly paired dependencies belong here.
export const featureIds = [
  "88-rich-text", "40-files", "20-speed", "22-budget", "26-notifications",
  "10-plan-mode", "93-chat-panels", "15-lang-icons",
] as const;

export type FeatureId = typeof featureIds[number];
export const featureKey = (id: FeatureId) => "chronos.olympus." + id;
