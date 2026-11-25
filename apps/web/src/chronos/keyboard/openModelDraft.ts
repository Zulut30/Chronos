import type { ScopedProjectRef } from "@t3tools/contracts";
import type { NewThreadHandler } from "../../hooks/useHandleNewThread";
import { useComposerDraftStore } from "../../composerDraftStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import {
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
} from "../../providerInstances";

export async function openModelDraft(
  project: ScopedProjectRef,
  open: NewThreadHandler,
  target: string,
) {
  const providers =
    appAtomRegistry.get(environmentServerConfigsAtom).get(project.environmentId)
      ?.providers ?? [];
  const entries = deriveProviderInstanceEntries(providers).filter(
    (p) => p.enabled && p.isAvailable,
  );
  const wanted = target.toLowerCase();
  const matches = entries.flatMap((p) => {
    const provider =
      [p.instanceId, p.displayName, p.driverKind].some(
        (id) => id.toLowerCase() === wanted,
      ) ||
      (wanted === "claude" && p.driverKind === "claudeAgent");
    const model = provider
      ? getDefaultProviderInstanceModel(providers, p.instanceId)
      : p.models.find((m) =>
          [m.slug, m.name, p.instanceId + "/" + m.slug].some(
            (s) => s.toLowerCase() === wanted,
          ),
        )?.slug;
    return model ? [{ instanceId: p.instanceId, model }] : [];
  });
  if (matches.length !== 1)
    throw new Error(
      "Модель недоступна или неоднозначна. Укажите экземпляр провайдера и модель в виде экземпляр/модель.",
    );
  const result = await open(project);
  if (result)
    useComposerDraftStore
      .getState()
      .setModelSelection(result.draftId, matches[0]!, { replaceOptions: true });
}
