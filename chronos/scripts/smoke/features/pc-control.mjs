import * as NodeTimersPromises from "node:timers/promises";

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
      await NodeTimersPromises.setTimeout(80);
    }
  };
  const state = 'window.chronosPC.settings({op:"state"})';
  await wait('!!document.querySelector("#pc-control form")');
  const initial = await evaluate(state);
  if (initial.settings.enabled) throw new Error("Управление включено в новом профиле");
  await evaluate('document.querySelector("#pc-control input[type=checkbox]").click()');
  await evaluate('document.querySelector("#pc-control button[type=submit]").click()');
  await wait(state + '.then(s => s.settings.enabled)');
  await evaluate('document.querySelector("#pc-control [data-pc-stop]").click()');
  await wait(state + '.then(s => !s.settings.enabled && s.history.some(e => e.op === "stop"))');
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
