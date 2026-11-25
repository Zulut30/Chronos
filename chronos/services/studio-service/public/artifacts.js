const find = s => document.querySelector(s);
const cards = find("#cards"), status = find("#status"), search = find("#search"), dialog = find("dialog");
let items = [], pending;
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
  Promise.resolve().then(action).catch(e => {status.textContent = e.message;});
}
function button(label, action) {
  const b = element("button", label);
  b.onclick = () => run(action);
  return b;
}
function askDelete(a) {
  pending = a;
  dialog.querySelector("h2").textContent = "Удалить «" + a.title + "»?";
  dialog.querySelector("p").textContent = "Будут удалены все версии и сохранённые данные приложения.";
  dialog.returnValue = "";
  dialog.showModal();
}
dialog.oncancel = () => {pending = null;};
dialog.querySelector("form").onsubmit = event => {
  event.preventDefault();
  const a = pending;
  pending = null;
  dialog.close();
  if (event.submitter?.value === "delete" && a) run(async () => {await request("delete",{id:a.id,expectedVersion:a.version});await refresh();});
};
function render() {
  cards.replaceChildren();
  const term = search.value.trim().toLocaleLowerCase("ru");
  for (const a of items.filter(a => (a.title+" "+a.description).toLocaleLowerCase("ru").includes(term))) {
    const card = element("article"), nav = element("nav"), history = element("details");
    const title = element("h2", (a.pinned ? "📌 " : "") + a.icon + " " + a.title);
    nav.append(button("Открыть", () => request("open",{id:a.id})),
      button(a.pinned ? "Открепить" : "Закрепить",async () => {await request("pin",{id:a.id,pinned:!a.pinned});await refresh();}),
      button("Удалить",() => askDelete(a)));
    const versions = element("ul");
    history.append(element("summary","История версий"),versions);
    history.ontoggle = () => {
      if (!history.open) return;
      run(async () => {
        versions.replaceChildren();
        for(const v of await request("history",{id:a.id})) {
          const li = element("li", "№ " + v.version + " · " + v.label + " ");
          if(v.version !== a.version) li.append(button("Восстановить",async () => {await request("restore",{id:a.id,version:v.version,expectedVersion:a.version});await refresh();}));
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
run(async () => {await refresh();const id=new URL(location.href).searchParams.get("delete");if(id){const a=items.find(a=>a.id===id);if(a) askDelete(a);}});
