import type { ScopedThreadRef } from "@t3tools/contracts";
import { useThreadFindOpen } from "~/components/chat/threadFindStore";
import { useThreadProjection } from "~/state/entities";

export function useFindProjection(thread: ScopedThreadRef | null, enabled: boolean) {
  const isOpen = useThreadFindOpen(thread, enabled);
  const content = useThreadProjection(isOpen ? thread : null)?.projection;
  return { isOpen, content };
}
