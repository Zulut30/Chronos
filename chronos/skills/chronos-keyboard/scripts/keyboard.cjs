#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  slots,
  actions,
  store,
  plan,
  write,
  pendingFile,
} = require("./profile.cjs");
try {
  const [cmd = "show", input] = process.argv.slice(2);
  const db = store(
    process.env.CHRONOS_HOME || path.join(os.homedir(), ".chronos"),
  );
  const current = db.load(db.state().active);
  if (cmd === "actions") console.log(JSON.stringify(actions, null, 2));
  else if (cmd === "profiles") console.log(JSON.stringify(db.names(), null, 2));
  else if (cmd === "show" || cmd === "plan") {
    const proposal =
      cmd === "plan"
        ? plan(db, JSON.parse(fs.readFileSync(input || 0, "utf8")))
        : null;
    const p = proposal?.profile ?? current;
    console.log(p.name);
    for (let i = 0; i < 9; i += 3)
      console.log(slots.slice(i, i + 3).join(" · "));
    for (const slot of slots) {
      const b = p.bindings[slot];
      console.log(
        slot,
        b?.signal ?? "ожидает обучения",
        b?.action ? actions[b.action.id] + " " + (b.action.arg ?? "") : "—",
      );
    }
    if (proposal) {
      write(pendingFile(db), proposal);
      console.log(
        "Предложение готово. Откройте Клавиатуры → Предложение ИИ и подтвердите назначения.",
      );
    }
  } else throw new Error("Команды: show, profiles, actions, plan [файл JSON].");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
