import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

export function* packedEntries(path, include) {
  const fd = openSync(path, "r");
  function read(offset, size) {
    const bytes = Buffer.alloc(size);
    let done = 0;
    while (done < size) {
      const n = readSync(fd, bytes, done, size - done, offset + done);
      assert.ok(n > 0, "truncated asar");
      done += n;
    }
    return bytes;
  }
  try {
    const header = read(0, 16);
    assert.equal(header.readUInt32LE(0), 4);
    assert.equal(header.readUInt32LE(4), header.readUInt32LE(8) + 4);
    const contents = 8 + header.readUInt32LE(4);
    const tree = JSON.parse(read(16, header.readUInt32LE(12)).toString("utf8"));
    function* walk(entries, parent) {
      for (const [name, entry] of Object.entries(entries)) {
        const key = parent + name;
        if (entry.files) {
          yield* walk(entry.files, key + "/");
        } else if (include(key)) {
          assert.ok(!entry.unpacked && entry.offset !== undefined, key);
          const bytes = read(contents + Number(entry.offset), entry.size);
          assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.integrity.hash, key + " archive integrity");
          yield [key, bytes];
        }
      }
    }
    yield* walk(tree.files, "");
  } finally {
    closeSync(fd);
  }
}
