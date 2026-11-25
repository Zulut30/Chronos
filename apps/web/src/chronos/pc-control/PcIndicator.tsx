import { lazy, Suspense, useState } from "react";
import { Button } from "../../components/ui/button";
import { useControl } from "./useControl";

const ApprovalRow = lazy(() => import("./ApprovalRow"));

export function PcIndicator() {
  const { state, send, error } = useControl();
  const [expanded, setExpanded] = useState(false);
  if (!state?.active && !state?.pending.length) return null;
  return (
    <aside
      aria-label="Управление ПК"
      className="fixed right-4 bottom-4 z-[100] max-h-[65vh] w-fit max-w-[min(24rem,92vw)] space-y-2 overflow-auto rounded-lg border bg-background p-3 text-sm shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span role="status">Агент управляет ПК</span>
        <Button variant="outline" size="sm" onClick={() => void send({ op: "stop" })}>
          Остановить
        </Button>
      </div>
      {state.pending.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          Запросы на подтверждение ({state.pending.length})
        </Button>
      )}
      {expanded && (
        <Suspense fallback={null}>
          {state.pending.map((item) => <ApprovalRow key={item.id} item={item} send={send} />)}
        </Suspense>
      )
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
