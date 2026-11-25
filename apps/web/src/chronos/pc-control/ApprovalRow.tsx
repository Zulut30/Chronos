import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { type Approval, labels } from "./useControl";

export default function ApprovalRow({ item, send }: { item: Approval; send: (input: unknown) => Promise<void> }) {
  const [value, setValue] = useState("");
  const decide = (allow: boolean) =>
    void send({ op: "decide", id: item.id, allow, ...(item.manual && allow ? { value } : {}) });
  return (
    <div className="space-y-2 border-t py-2">
      <p className="break-all">
        {labels[item.op]} · {item.target}
        {item.label && " · " + item.label}
      </p>
      {item.proposal !== undefined && (
        <p className="max-h-20 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
          {item.proposal}
        </p>
      )}
      {item.manual && (
        <label className="block">
          Значение для этого поля
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
          Разрешить
        </Button>
        <Button variant="outline" size="sm" onClick={() => decide(false)}>
          Отклонить
        </Button>
      </div>
    </div>
  );
}
