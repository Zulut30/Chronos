import { useLocale } from "gt-react";
import labels from "../../../../../chronos/l10n/claude-idle-unload.json";
import { IntervalSecondsField } from "../../components/settings/IntervalSecondsField";
import { SettingsRow } from "../../components/settings/settingsLayout";

export function ClaudeIdleUnloadRow({
  minutes,
  disabled,
  onCommit,
}: {
  minutes: number | undefined;
  disabled: boolean;
  onCommit: (minutes: number, options: { onFailed: () => void }) => void;
}) {
  const copy = useLocale().startsWith("ru") ? labels.ru : labels.en;
  if (minutes === undefined) return null;
  return (
    <SettingsRow
      id="claude-idle-unload"
      serverScoped
      settingKeys={["claudeIdleUnloadMinutes"]}
      title={copy.title}
      description={copy.description}
      control={
        <fieldset disabled={disabled} className="flex items-center gap-2 disabled:opacity-50">
          <IntervalSecondsField
            value={minutes}
            step={1}
            min={0}
            labels={copy}
            onCommit={onCommit}
          />
          <span className="text-xs text-muted-foreground">{copy.minutes}</span>
        </fieldset>
      }
    />
  );
}
