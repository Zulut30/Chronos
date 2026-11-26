import { msg, useGT, useMessages } from "gt-react";
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
}: {
  settings: Settings;
  send: (input: unknown) => Promise<void>;
}) {
  const gt = useGT();
  const m = useMessages();
  const formId = "pc-control-permissions";
  const [draft, setDraft] = useState(settings);
  const [apps, setApps] = useState(settings.apps.join("\n"));
  const [pending, setPending] = useState(false);
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
      <form
        hidden
        id={formId}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || !changed) return;
          setPending(true);
          try {
            await send({ op: "configure", settings: { ...draft, apps: allowed } });
          } finally {
            setPending(false);
          }
        }}
      />
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
          title={<label htmlFor={formId + "-apps"}>{gt("Allowed apps and websites")}</label>}
          description={gt("Enter one app name, executable path or website address per line.")}
          control={
            <Textarea
              id={formId + "-apps"}
              rows={3}
              className="w-full @min-[32rem]/settings-row:w-64"
              placeholder={"notepad.exe\nhttps://example.org"}
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
            <SelectPopup align="end" alignItemWithTrigger={false}>
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
          <Button
            type="submit"
            form={formId}
            variant="outline"
            size="sm"
            disabled={!changed || pending}
          >
            {gt("Apply")}
          </Button>
        }
      />
    </>
  );
}

export default function PcSettings() {
  const gt = useGT();
  const m = useMessages();
  const { state, send, error, retry } = useControl();
  return (
    <>
      <SettingsSection id="pc-control" title={gt("Computer control")}>
        {state && (
          <>
            <Permissions
              key={JSON.stringify(state.settings)}
              settings={state.settings}
              send={send}
            />
            <SettingsRow
              title={gt("Emergency stop")}
              description={
                <>
                  {gt(
                    "Stop all computer control actions. On Windows this also closes windows opened on the agent’s private desktop.",
                  )}{" "}
                  <Kbd>Ctrl / ⌘ + Alt + Shift + F12</Kbd>
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
