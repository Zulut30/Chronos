import { Atom } from "effect/reactivity";

const INTERVAL_MS = 125;
const MIN_LENGTH = 4096;

/** Each live item owns its timer. Settled rows read the final projection directly. */
export const streamingMarkdownAtom = Atom.family((source: Atom.Atom<string | null>) =>
  Atom.make<string | null>((get) => {
    let latest = get.once(source);
    let published = latest;
    let lastPublish = performance.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function publish() {
      timeout = undefined;
      if (published === latest) return;
      lastPublish = performance.now();
      published = latest;
      get.setSelf(latest);
    }

    get.subscribe(source, (text) => {
      latest = text;
      const remaining = INTERVAL_MS - (performance.now() - lastPublish);
      if (text === null || text.length < MIN_LENGTH || text.length <= (published?.length ?? 0) || remaining <= 0) {
        clearTimeout(timeout);
        publish();
      } else if (timeout === undefined) {
        timeout = setTimeout(publish, remaining);
      }
    });
    get.addFinalizer(() => clearTimeout(timeout));
    return latest;
  }),
);
