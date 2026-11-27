async function verifyPcControl(client) {
  const navigation = await client.probe("performAction", { type:"navigate", to:"/settings/general" });
  if (!navigation.ok) throw new Error(navigation.detail);
  const evaluate = async expression => {
    const response = await client.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? "Ошибка интерфейса");
    return response.result.value;
  };
  const wait = async expression => {
    const deadline = Date.now()+10000;
    while (!await evaluate(expression)) {
      if (Date.now() > deadline) throw new Error("Не достигнуто состояние " + expression);
      await client.pumpFrames(1, 80);
    }
  };
  const state = 'window.chronosPC.settings({op:"state"})';
  await wait('!!document.querySelector("#pc-control form")');
  const initial = await evaluate(state);
  if (initial.settings.enabled) throw new Error("Управление включено в новом профиле");
  const enable = '#pc-control [role=switch][aria-label="Разрешить агентам управлять ПК"]';
  await wait('document.querySelector(' + JSON.stringify(enable) + ')?.getAttribute("aria-checked") === "false"');
  await evaluate('document.querySelector(' + JSON.stringify(enable) + ').focus()');
  for (const type of ["rawKeyDown", "keyUp"]) {
    await client.send("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  }
  await wait('document.querySelector(' + JSON.stringify(enable) + ')?.getAttribute("aria-checked") === "true"');
  await evaluate('document.querySelector("#pc-control button[type=submit]").click()');
  await wait(state + '.then(s => s.settings.enabled)');
  // Desktop IPC can confirm the write before React paints the enabled stop button.
  const stop = "#pc-control button[data-pc-stop]";
  await wait('document.querySelector(' + JSON.stringify(stop) + ')?.disabled === false');
  await evaluate('document.querySelector(' + JSON.stringify(stop) + ').click()');
  await wait(state + '.then(s => !s.settings.enabled && s.history.some(e => e.op === "stop"))');
  await wait('document.querySelector(' + JSON.stringify(stop) + ')?.disabled === true');
}

export async function check({ client, opts, report }) {
  if (opts.verifyPcControl) {
    report.summary.totalChecks++;
    try {
      await verifyPcControl(client);
      report.checks.pcControl = {ok:true};
      report.summary.passedChecks++;
    } catch (error) {
      report.checks.pcControl = {ok:false,error:String(error)};
      report.summary.failedChecks++;
      report.ok = false;
      console.log("[FAIL] Управление ПК: " + error);
    }
  }
}
