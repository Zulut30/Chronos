import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";

export function makeThreadChannels<K, A>(keyOf: (event: A) => K) {
  const channels = new Map<K, { bus: PubSub.PubSub<A>; users: number }>();
  const acquire = (key: K) => Effect.acquireRelease(
    Effect.gen(function* () {
      let channel = channels.get(key);
      if (!channel) {
        const bus = yield* PubSub.unbounded<A>();
        channel = channels.get(key) ?? { bus, users: 0 };
        channels.set(key, channel);
      }
      channel.users++;
      return channel;
    }),
    (channel) => Effect.sync(() => {
      if (--channel.users === 0) channels.delete(key);
    }),
  ).pipe(Effect.map((channel) => channel.bus));
  const publish = Effect.fnUntraced(function* (events: ReadonlyArray<A>) {
    if (!channels.size) return;
    const groups = new Map<PubSub.PubSub<A>, A[]>();
    for (const event of events) {
      const channel = channels.get(keyOf(event));
      if (!channel) continue;
      const group = groups.get(channel.bus);
      if (group) group.push(event);
      else groups.set(channel.bus, [event]);
    }
    for (const [bus, group] of groups) yield* PubSub.publishAll(bus, group);
  });
  return { acquire, publish };
}
