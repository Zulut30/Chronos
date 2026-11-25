import type { IssueDetail } from "@t3tools/contracts";
import { InlineButton } from "../../components/ui/button";
import { useTrelloCopy } from "./TrelloSettings";

export function TrelloCardFields({ detail }: { detail: IssueDetail }) {
  const t = useTrelloCopy();
  return (
    <>
      {detail.due && (
        <div className="text-sm">
          {t("Due date")} ·{" "}
          <time dateTime={detail.due}>{new Date(detail.due).toLocaleString()}</time>
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
