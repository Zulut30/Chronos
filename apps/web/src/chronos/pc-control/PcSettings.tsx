import "../settingsSelect.css";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { useState } from "react";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { FoldedSettingsSection } from "../../components/settings/FoldedSettingsSection";
import { Button } from "../../components/ui/button";
import { Kbd } from "../../components/ui/kbd";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { actionLabels } from "./actionLabels";
import { type Mode, type Settings, useControl } from "./useControl";

const modes = {
  every: msg("Every action"),
  risk: msg("Only risky actions"),
  none: msg("Skip approval for routine actions"),
} satisfies Record<Mode, string>;

function Permissions({
  settings,
  send,
  isMac,
}: {
  settings: Settings;
  isMac: boolean;
  send: (input: unknown) => Promise<void>;
}) {
  const gt = useGT();
  const m = useMessages();
  const saved = JSON.stringify(settings);
  const [lastSaved, setLastSaved] = useState(saved);
  const [draft, setDraft] = useState(settings);
  const [apps, setApps] = useState(settings.apps.join("\n"));
  const [pending, setPending] = useState(false);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setDraft(settings);
    setApps(settings.apps.join("\n"));
  }
  const allowed = apps
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const changed =
    draft.enabled !== settings.enabled ||
    draft.all !== settings.all ||
    draft.mode !== settings.mode ||
    allowed.join("\n") !== settings.apps.join("\n");

  return (
    <>
      <SettingsRow
        devicePreference
        title={gt("Allow agents to control this computer")}
        control={
          <Switch
            aria-label={gt("Allow agents to control this computer")}
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        }
      />
      <SettingsRow
        devicePreference
        title={gt("All apps and websites")}
        control={
          <Switch
            aria-label={gt("All apps and websites")}
            checked={draft.all}
            onCheckedChange={(all) => setDraft({ ...draft, all })}
          />
        }
      />
      {!draft.all && (
        <SettingsRow
          devicePreference
          title={<label htmlFor="pc-control-apps">{gt("Allowed apps and websites")}</label>}
          description={gt("Enter one app name, executable path or website address per line.")}
          control={
            <Textarea
              id="pc-control-apps"
              rows={3}
              className="w-full @min-[32rem]/settings-row:w-64"
              placeholder={isMac ? "TextEdit\nhttps://example.org" : "notepad.exe\nhttps://example.org"}
              value={apps}
              onChange={(event) => setApps(event.target.value)}
            />
          }
        />
      )}
      <SettingsRow
        devicePreference
        title={gt("Approvals")}
        description={gt(
          "Entering passwords or payment details, deleting, and submitting messages or forms require approval. Chronos also asks when the purpose of a button or field is unclear.",
        )}
        control={
          <Select
            value={draft.mode}
            onValueChange={(mode) => {
              if (mode === "every" || mode === "risk" || mode === "none")
                setDraft({ ...draft, mode });
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={gt("Approvals")}
              className="w-full @min-[32rem]/settings-row:w-56"
            >
              <SelectValue>{m(modes[draft.mode])}</SelectValue>
            </SelectTrigger>
            <SelectPopup data-chronos-settings-options="" align="end" alignItemWithTrigger={false}>
              {Object.entries(modes).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {m(label)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        devicePreference
        title={gt("Permission changes")}
        control={
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending || !changed) return;
              setPending(true);
              await send({ op: "configure", settings: { ...draft, apps: allowed } });
              setPending(false);
            }}
          >
            <Button type="submit" variant="outline" size="sm" aria-disabled={!changed || pending}>
              {gt("Apply")}
            </Button>
          </form>
        }
      />
    </>
  );
}

export default function PcSettings() {
  const gt = useGT();
  const m = useMessages();
  const { state, send, error, retry } = useControl();
  const locale = useLocale();
  const isMac = window.desktopBridge?.getClientPlatform?.() === "darwin";
  if (state?.available === false) {
    const reason = gt("Computer control is unavailable because this build lacks the agent-desktop component.");
    return (
      <SettingsSection id="pc-control" title={gt("Computer control")}>
        <SettingsRow title={<span role="status">{locale.startsWith("ru") ? state.unavailableReason || reason : reason}</span>} />
      </SettingsSection>
    );
  }
  return (
    <>
      <SettingsSection id="pc-control" title={gt("Computer control")}>
        {state && (
          <>
            <Permissions settings={state.settings} send={send} isMac={isMac} />
            <SettingsRow
              title={gt("Emergency stop")}
              description={
                <>
                  {isMac
                    ? gt("Stop all computer control actions. To control apps on this Mac, allow Chronos in System Settings → Privacy & Security → Accessibility.")
                    : gt("Stop all computer control actions. On Windows this also closes windows opened on the agent’s private desktop.")}{" "}
                  <Kbd>{isMac ? "⌘ + Option + Shift + F12" : "Ctrl / ⌘ + Alt + Shift + F12"}</Kbd>
                </>
              }
              control={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-pc-stop
                  disabled={!state.settings.enabled}
                  onClick={() => void send({ op: "stop" })}
                >
                  {gt("Stop computer control")}
                </Button>
              }
            />
          </>
        )}
        {error ? (
          <SettingsRow
            title={
              <span role="alert" className="text-destructive">
                {error}
              </span>
            }
            control={
              <Button type="button" variant="outline" size="sm" onClick={retry}>
                {gt("Retry")}
              </Button>
            }
          />
        ) : (
          !state && (
            <SettingsRow
              title={<span role="status">{gt("Loading computer control settings…")}</span>}
            />
          )
        )}
      </SettingsSection>
      {state && (
        <FoldedSettingsSection
          id="pc-control-history"
          title={gt("Action log")}
          summary={String(state.history.length)}
        >
          {state.history.length === 0 ? (
            <SettingsRow title={gt("No actions yet.")} />
          ) : (
            state.history
              .toReversed()
              .map((entry) => (
                <SettingsRow
                  key={entry.id}
                  title={m(actionLabels[entry.op] ?? msg("Request"))}
                  description={new Date(entry.time).toLocaleTimeString()}
                  status={entry.status === "ok" ? gt("Done") : gt("Not completed")}
                />
              ))
          )}
        </FoldedSettingsSection>
      )}
    </>
  );
}
