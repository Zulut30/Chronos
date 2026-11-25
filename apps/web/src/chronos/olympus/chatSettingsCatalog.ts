import { msg } from "gt-react";
import type { FeatureId } from "./featureFlags";
import { preferenceKeys } from "./chatPreferences";

export const modules = [
  {
    id: "88-rich-text", title: msg("Colored chat text"),
    description: msg("Show colors and emphasis in messages and keep formatting when copying."),
  },
  {
    id: "40-files", title: msg("File and folder downloads"),
    description: msg("Download files and ZIP folders from the environment. Also enables project icons from disk."),
  },
  {
    id: "20-speed", title: msg("Generation speed and tokens"),
    description: msg("Show tokens per second in the composer and collect statistics by model."),
  },
  {
    id: "22-budget", title: msg("Budgets and usage limits"),
    description: msg("Show remaining quotas, reset times and chat cost. Background chat alerts also use this module."),
  },
  {
    id: "26-notifications", title: msg("Background chat notifications"),
    description: msg("Show a bell for completed turns, errors, questions and approval requests."),
  },
  {
    id: "10-plan-mode", title: msg("Chat response modes"),
    description: msg("Choose execution, planning, brainstorming, bug hunting or design planning for each chat."),
  },
  {
    id: "93-chat-panels", title: msg("Side-by-side chats"),
    description: msg("Open a chat on the right or place two chats side by side in the panel."),
  },
  {
    id: "15-lang-icons", title: msg("Colored language icons"),
    description: msg("Use Olympus icons for file types in the file tree and diffs."),
  },
] as const satisfies readonly { id: FeatureId; title: string; description: string }[];

export type Preference = {
  id: keyof typeof preferenceKeys;
  title: string;
  description: string;
  requires?: FeatureId;
} & ({ options: readonly (readonly [string, string])[] } | { defaultOn: boolean });

export const preferences: readonly Preference[] = [
  {
    id: "downloads", title: msg("Download method"),
    description: msg("Choose how the next download accesses files in the environment."),
    requires: "40-files",
    options: [
      ["auto", msg("Choose automatically")],
      ["t3", msg("Through T3 only")],
    ],
  },
  {
    id: "notifications", title: msg("Chat notification mode"),
    description: msg("Choose when background chats can show a notification or play a sound."),
    requires: "26-notifications",
    options: [
      ["all", msg("All background chats")],
      ["minimized", msg("Only when minimized")],
      ["silent", msg("Without sound")],
      ["off", msg("Notifications off")],
    ],
  },
  {
    id: "follow", title: msg("Keep panel chats when switching threads"),
    description: msg("Keep the chats on the right when you switch the main chat in the same environment."),
    requires: "93-chat-panels",
    defaultOn: true,
  },
  {
    id: "modelFilter", title: msg("OpenRouter mention filter"),
    description: msg("Choose which models appear when you next open the model mention menu."),
    options: [
      ["all", msg("All model types")],
      ["text", msg("Text models")],
      ["image", msg("Image models")],
      ["video", msg("Video models")],
      ["speech", msg("Speech synthesis")],
      ["transcription", msg("Speech transcription")],
      ["audio", msg("Audio models")],
      ["decision", msg("Decision models")],
    ],
  },
  {
    id: "taskMode", title: msg("Response mode for task chats"),
    description: msg("Preset the response mode in the next task launch dialog."),
    requires: "10-plan-mode",
    options: [
      ["default", msg("Task execution")],
      ["plan", msg("Task planning")],
      ["brainstorm", msg("Brainstorming")],
      ["bug-hunter", msg("Bug hunting")],
      ["design-plan", msg("Design planning")],
    ],
  },
  {
    id: "taskWorktree", title: msg("New worktree for task chats"),
    description: msg("Preselect a separate working directory the next time you launch a task."),
    defaultOn: false,
  },
  {
    id: "taskBoard", title: msg("Attach the project board to task chats"),
    description: msg("Preselect an available Excalidraw board the next time you launch a task."),
    defaultOn: true,
  },
  {
    id: "taskAutostart", title: msg("Start tasks mentioned in chat"),
    description: msg("Move a backlog task to In progress when you insert it into a message."),
    defaultOn: true,
  },
];

export const olympusCopy = {
  restart: msg("Changes to Olympus switches take effect after you reload this window."),
  error: msg("Could not save this setting on this device."),
  aliases: msg("Machine names in mentions"),
  aliasesDescription: msg("Use the pencil next to an environment to change its display name in chat mentions."),
  editAliases: msg("Edit machine names"),
};

export const olympusSearchItems = [...modules, ...preferences, { id: "aliases", title: olympusCopy.aliases }].map(
  ({ id, title }) => ({ id: `olympus-${id}` as const, title, to: "/settings/appearance" as const }),
);

export const advancedOlympusIds = olympusSearchItems.slice(2).map(({ id }) => id);
