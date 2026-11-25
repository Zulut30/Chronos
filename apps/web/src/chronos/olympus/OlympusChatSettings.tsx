import { Link } from "@tanstack/react-router";
import { useMessages } from "gt-react";
import { useState, useSyncExternalStore } from "react";

import { SettingsRow } from "../../components/settings/settingsLayout";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { modules, olympusCopy, preferences, type Preference } from "./chatSettingsCatalog";
import { featureKey, type FeatureId } from "./featureFlags";
import {
  choiceValue, followsChat, modelFilter, notifyPreferenceChange, preferenceKeys,
  readPreference, writeFeature, writePreference,
} from "./chatPreferences";

const listeners = new Set<() => void>();
function refresh() {
  for (const listener of listeners) listener();
}
function nativeMenuClick(event: MouseEvent) {
  // The original menus write directly to storage in the same document.
  if (event.composedPath().some((node) => node instanceof Element &&
    node.matches(".oly-notify-menu, [data-a=follow], .oly-tk-launch, .oly-or-chip"))) refresh();
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("click", nativeMenuClick);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.removeEventListener("storage", refresh);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("click", nativeMenuClick);
  };
}

function useStored(key?: string) {
  return useSyncExternalStore(subscribe, () => key ? readPreference(key) : null, () => null);
}

function useAvailable(id?: FeatureId) {
  const own = useStored(id && featureKey(id));
  const bus = useStored(id === "26-notifications" ? featureKey("22-budget") : undefined);
  return own !== "0" && bus !== "0";
}

function useSettingWrite() {
  const m = useMessages();
  const [failed, setFailed] = useState(false);
  function save(key: string, action: () => void) {
    try {
      action();
      notifyPreferenceChange(key, localStorage.getItem(key));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return { save, status: failed ? <span role="alert">{m(olympusCopy.error)}</span> : undefined };
}

function ModuleRow({ entry }: { entry: typeof modules[number] }) {
  const m = useMessages();
  const { save, status } = useSettingWrite();
  const enabled = useAvailable(entry.id);
  const available = useAvailable(entry.id === "26-notifications" ? "22-budget" : undefined);
  const title = m(entry.title);
  return (
    <SettingsRow devicePreference id={`olympus-${entry.id}`} title={title}
      description={m(entry.description)} status={status}
      control={<Switch aria-label={title} checked={enabled} disabled={!available}
        onCheckedChange={(on) => save(featureKey(entry.id), () => writeFeature(localStorage, entry.id, on))} />}
    />
  );
}

function PreferenceRow({ entry }: { entry: Preference }) {
  const m = useMessages();
  const { save, status } = useSettingWrite();
  const key = preferenceKeys[entry.id];
  const raw = useStored(key);
  const enabled = useAvailable(entry.requires);
  const title = m(entry.title);
  function change(value: string) {
    save(key, () => writePreference(localStorage, key, value, globalThis.__olyPanels));
    if (entry.id === "notifications" && value !== "off" && globalThis.Notification?.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  }
  let control;
  if ("options" in entry) {
    const selected = choiceValue(entry.id === "modelFilter" ? modelFilter(raw) : raw,
      entry.options.map(([value]) => value));
    control = (
      <Select disabled={!enabled} value={selected} onValueChange={(next) => {
        if (next !== null && entry.options.some(([value]) => value === next)) change(next);
      }}>
        <SelectTrigger size="sm" className="w-full min-w-0 sm:w-48" aria-label={title}>
          <SelectValue>{m(entry.options.find(([value]) => value === selected)![1])}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {entry.options.map(([value, label]) => <SelectItem key={value} value={value}>{m(label)}</SelectItem>)}
        </SelectPopup>
      </Select>
    );
  } else {
    const checked = entry.id === "follow" ? followsChat(raw) : entry.defaultOn ? raw !== "0" : raw === "1";
    control = <Switch aria-label={title} checked={checked} disabled={!enabled}
      onCheckedChange={(on) => change(on ? "1" : "0")} />;
  }
  return <SettingsRow devicePreference id={`olympus-${entry.id}`} title={title}
    description={m(entry.description)} status={status} control={control} />;
}

export function OlympusChatSettings({ advanced = false }: { advanced?: boolean }) {
  const m = useMessages();
  return <>
    <p className="px-3 py-2 text-xs text-muted-foreground sm:px-4">{m(olympusCopy.restart)}</p>
    {(advanced ? modules.slice(2) : modules.slice(0, 2)).map((entry) => <ModuleRow key={entry.id} entry={entry} />)}
    {advanced && <>
      {preferences.map((entry) => <PreferenceRow key={entry.id} entry={entry} />)}
      <SettingsRow devicePreference id="olympus-aliases" title={m(olympusCopy.aliases)}
        description={m(olympusCopy.aliasesDescription)}
        control={<Link to="/settings/connections" className="text-sm text-primary underline">{m(olympusCopy.editAliases)}</Link>} />
    </>}
  </>;
}
