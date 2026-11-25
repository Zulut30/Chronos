import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
// Adapters publish immutable snapshots. Retaining only the byte count lets the encoded text go.
export function makeSnapshotSizer(encodeSnapshot: typeof encode = encode) {
  const sizes = new WeakMap<object, number>();
  return (snapshot: object) =>
    Effect.suspend(() => {
      const size = sizes.get(snapshot);
      if (size !== undefined) return Effect.succeed(size);
      return Effect.map(encodeSnapshot(snapshot), (json) => {
        const bytes = Buffer.byteLength(json);
        sizes.set(snapshot, bytes);
        return bytes;
      });
    });
}
