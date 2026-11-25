import type { IssueDetail } from "@t3tools/contracts";
import { useState } from "react";
import { useGT } from "gt-react";
import { Input } from "../../components/ui/input";
import { Button, InlineButton } from "../../components/ui/button";
import { useTrelloCopy } from "./TrelloSettings";

function localInput(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TrelloCardFields({
  detail,
  editable,
  busy,
  onSave,
}: {
  detail: IssueDetail;
  editable: boolean;
  busy: boolean;
  onSave: (due: string | null) => Promise<boolean>;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState<string | null>(null);
  const t = useTrelloCopy();
  return (
    <>
      {(detail.due || editable) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("Due date")}</span>
          {draft === null || !editable ? (
            <>
              {detail.due && (
                <time dateTime={detail.due}>{new Date(detail.due).toLocaleString()}</time>
              )}
              {editable && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDraft(localInput(detail.due))}
                >
                  {gt("Edit")}
                </Button>
              )}
            </>
          ) : (
            <>
              <Input
                type="datetime-local"
                size="sm"
                aria-label={t("Due date")}
                value={draft}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button
                size="xs"
                disabled={busy || draft === localInput(detail.due)}
                onClick={async () => {
                  if (await onSave(draft ? new Date(draft).toISOString() : null)) setDraft(null);
                }}
              >
                {gt("Save")}
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                {gt("Cancel")}
              </Button>
            </>
          )}
        </div>
      )}
      {!!detail.attachments?.length && (
        <div className="grid gap-1 text-sm">
          <span>{t("Attachments")}</span>
          {detail.attachments.map((a, index) => (
            <InlineButton
              key={index}
              render={<a href={a.url} target="_blank" rel="noopener noreferrer" />}
            >
              {a.name || a.url}
            </InlineButton>
          ))}
        </div>
      )}
    </>
  );
}
