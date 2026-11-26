import { useGT, useMessages } from "gt-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { actionLabels } from "./actionLabels";
import { useControl, type Approval } from "./useControl";

function ApprovalRow({ item, send }: { item: Approval; send: (input: unknown) => Promise<void> }) {
  const gt = useGT();
  const m = useMessages();
  const [value, setValue] = useState("");
  const decide = (allow: boolean) =>
    void send({ op: "decide", id: item.id, allow, ...(item.manual && allow ? { value } : {}) });
  return (
    <div className="space-y-2 border-t py-2">
      <p className="break-all">
        {actionLabels[item.op] ? m(actionLabels[item.op]!) : item.op} · {item.target}
        {item.label && " · " + item.label}
      </p>
      {item.proposal !== undefined && (
        <p className="max-h-20 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
          {item.proposal}
        </p>
      )}
      {item.manual && (
        <label className="block">
          {gt("Value for this field")}
          <Input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1"
          />
        </label>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={item.manual && !value}
          onClick={() => decide(true)}
        >
          {gt("Allow")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => decide(false)}>
          {gt("Deny")}
        </Button>
      </div>
    </div>
  );
}

export function PcIndicator() {
  const gt = useGT();
  const { state, send, error } = useControl();
  const [expanded, setExpanded] = useState(false);
  if (!state?.active && !state?.pending.length) return null;
  return (
    <aside
      aria-label={gt("Computer control")}
      className="fixed right-4 bottom-4 z-[100] max-h-[65vh] w-fit max-w-[min(24rem,92vw)] space-y-2 overflow-auto rounded-lg border bg-background p-3 text-sm shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span role="status">{gt("An agent is controlling the computer")}</span>
        <Button variant="outline" size="sm" onClick={() => void send({ op: "stop" })}>
          {gt("Stop")}
        </Button>
      </div>
      {state.pending.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {gt("Approval requests ({count})", { count: state.pending.length })}
        </Button>
      )}
      {expanded &&
        state.pending.map((item) => <ApprovalRow key={item.id} item={item} send={send} />)}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
