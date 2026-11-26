const find = s => document.querySelector(s);
const cards = find("#cards"), status = find("#status"), search = find("#search"), dialog = find("dialog");
let items = [], pending;
function applyTheme(hash) {
  const params = new URLSearchParams(hash);
  if (!["light","dark"].includes(params.get("theme"))) return;
  const root = document.documentElement;
  root.style.colorScheme = params.get("theme");
  for (const key of ["bg","fg","panel","accent","border","primary"]) {
    const color = params.get(key);
    if (color && CSS.supports("color", color)) root.style.setProperty("--gallery-" + key, color);
    else root.style.removeProperty("--gallery-" + key);
  }
}
applyTheme(location.hash.slice(1));
window.addEventListener("message", event => {
  if (event.source === parent && event.origin === "t3code://app" && event.data?.type === "oly-studio-theme") {
    applyTheme(event.data.hash);
  }
});
function element(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text ?? "";
  return el;
}
async function request(action, params = {}) {
  const r = await fetch("/api/artifacts/" + action, {method:"POST", headers:{"Content-Type":"application/json","x-oly":"1"},body:JSON.stringify(params)});
  const result = await r.json();
  if (!r.ok) throw Error(result.error);
  return result;
}
function run(action) {
  Promise.resolve().then(action).catch(e => {
    status.textContent = /^[А-Яа-яЁё]/u.test(e.message) ? e.message : "Не удалось связаться со Студией. Обновите галерею.";
  });
}
function button(label, action) {
  const b = element("button", label);
  b.onclick = () => run(action);
  return b;
}
function askDelete(a) {
  pending = a;
  dialog.querySelector("h2").textContent = "Удалить «" + a.title + "»?";
  dialog.querySelector("p").textContent = "Артефакт можно восстановить из корзины вместе с версиями и данными.";
  dialog.returnValue = "";
  dialog.showModal();
}
dialog.oncancel = () => {pending = null;};
dialog.querySelector("form").onsubmit = event => {
  event.preventDefault();
  const a = pending;
  pending = null;
  dialog.close();
  if (event.submitter?.value === "delete" && a) run(async () => {
    await request("delete",{id:a.id,expectedVersion:a.version});
    await refresh();
    search.focus();
    status.replaceChildren(element("span","Артефакт в корзине "),button("Отменить",async()=>{
      await request("recover",{id:a.id});
      await refresh();
      cards.querySelector(`article[data-id="${CSS.escape(a.id)}"] [data-pin]`)?.focus();
    }));
  });
};
function render() {
  cards.replaceChildren();
  const term = search.value.trim().toLocaleLowerCase("ru");
  for (const a of items.filter(a => (a.title+" "+a.description).toLocaleLowerCase("ru").includes(term))) {
    const card = element("article"), nav = element("nav"), history = element("details");
    const title = element("h2", (a.pinned ? "📌 " : "") + a.icon + " " + a.title);
    card.dataset.id = a.id;
    const pin = button(a.pinned ? "Открепить" : "Закрепить",async () => {
      await request("pin",{id:a.id,pinned:!a.pinned});
      await refresh();
      cards.querySelector(`article[data-id="${CSS.escape(a.id)}"] [data-pin]`)?.focus();
    });
    pin.dataset.pin = "";
    nav.append(button("Открыть", () => request("open",{id:a.id})), pin,
      button("Удалить",() => askDelete(a)));
    const versions = element("ul");
    history.append(element("summary","История версий"),versions);
    history.ontoggle = () => {
      if (!history.open) return;
      run(async () => {
        const entries = await request("history",{id:a.id});
        if (!history.open || !history.isConnected) return;
        versions.replaceChildren();
        for(const v of entries) {
          const li = element("li", "№ " + v.version + " · " + v.label + " ");
          if(v.version !== a.version) li.append(button("Восстановить",async () => {
            await request("restore",{id:a.id,version:v.version,expectedVersion:a.version});
            await refresh();
            const updated = cards.querySelector(`article[data-id="${CSS.escape(a.id)}"] details`);
            if (updated) { updated.open=true; updated.querySelector("summary").focus(); }
          }));
          versions.append(li);
        }
      });
    };
    card.append(title,element("p",a.description),nav,history);
    cards.append(card);
  }
  status.textContent = cards.childElementCount ? "" : (term ? "Ничего не найдено" : "Пока нет артефактов");
}
async function refresh() {items = await request("list");render();}
search.oninput = render;
run(async () => {await refresh();const id=new URL(location.href).searchParams.get("delete");if(id){const a=items.find(a=>a.id===id);if(a) askDelete(a);else status.textContent="Артефакт уже удалён."; }});
