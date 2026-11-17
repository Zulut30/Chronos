import { useEffect, useState } from "react";
import { serviceRequest, type LocalService } from "./services";

export function useServiceData<T>(service: LocalService, path: string) {
  const [result, setResult] = useState<{ key: string; value: T | null; error: string } | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const key = `${service}:${path}:${revision}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the external local service and aborts when the selected resource changes
  useEffect(() => {
    const controller = new AbortController();
    void serviceRequest<T>(service, path, { signal: controller.signal }).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ key, value, error: "" });
      },
      (reason) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            value: null,
            error: String(reason instanceof Error ? reason.message : reason),
          });
      },
    );
    return () => controller.abort();
  }, [service, path, key]);
  return {
    value: result?.key === key ? result.value : null,
    error: result?.key === key ? result.error : "",
    refresh: () => setRevision((current) => current + 1),
  };
}
