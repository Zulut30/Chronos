const effort = new Map([
  ["None", "Нет"], ["Minimal", "Минимальный"], ["Ultra", "Ультра"],
  ["Low", "Низкий"], ["Medium", "Средний"], ["High", "Высокий"],
  ["Extra High", "Очень высокий"], ["Max", "Максимальный"],
]);

const speed = new Map([["Fast", "Быстрый"], ["Ultrafast", "Сверхбыстрый"]]);

// A provider detail contains only traits; its first segment can itself be the effort.
export function effortDetail(label: string, locale: string): string {
  if (!locale.startsWith("ru")) return label;
  return label.split(" · ").map((part) => {
    if (part === "Standard") return "Стандартный";
    // buildTraitsTriggerDisplay appends the active speed to the reasoning level.
    const split = part.lastIndexOf(" ");
    const level = effort.get(part.slice(0, split));
    const tier = speed.get(part.slice(split + 1));
    return level && tier ? `${level} · ${tier}` : effort.get(part) ?? speed.get(part) ?? part;
  }).join(" · ");
}

export function effortLabel(label: string, locale: string): string {
  if (!locale.startsWith("ru")) return label;
  const parts = label.split(" · ");
  return parts.map((part, index) =>
    index === 0 && parts.length > 1 ? part : effort.get(part) ?? part,
  ).join(" · ");
}

const healthMessages = new Map([
  ["Sign in with Cursor or add CURSOR_API_KEY in provider settings.", "Войдите в Cursor или добавьте CURSOR_API_KEY в настройках провайдера."],
  ["Antigravity is installed. Google account access is not checked yet.", "Antigravity установлен. Доступ к аккаунту Google ещё не проверен."],
  ["Enter a Gemini API key in the Antigravity provider settings.", "Введите API-ключ Gemini в настройках провайдера Antigravity."],
]);

export function providerStatusMessage(message: string, locale: string): string {
  return locale.startsWith("ru") ? healthMessages.get(message) ?? message : message;
}

const notices = new Map([
  ["Codex could not be started to read usage.", "Не удалось запустить Codex для получения данных об использовании."],
  ["Codex exited before it could report usage.", "Codex завершил работу до получения данных об использовании."],
  ["Codex did not answer the usage request.", "Codex не ответил на запрос данных об использовании."],
  ["Could not read limits.", "Не удалось получить лимиты."],
  ["Sign in with Google to see Antigravity limits.", "Войдите через Google, чтобы увидеть лимиты Antigravity."],
  ["Cursor could not read usage limits.", "Не удалось получить лимиты Cursor."],
  ["Grok could not read usage limits.", "Не удалось получить лимиты Grok."],
  ["OpenCode Go could not read usage.", "Не удалось получить данные об использовании OpenCode Go."],
]);

export function usageNotice(notice: string, locale: string): string {
  if (!locale.startsWith("ru")) return notice;
  const separator = notice.lastIndexOf(": ");
  const offset = separator < 0 ? 0 : separator + 2;
  const message = notice.slice(offset);
  const rpcFailure = /^Codex could not read usage \(JSON-RPC (-?\d+)\)\.$/u.exec(message);
  const translated = rpcFailure
    ? `Не удалось получить данные об использовании Codex (JSON-RPC ${rpcFailure[1]}).`
    : notices.get(message);
  return translated ? notice.slice(0, offset) + translated : notice;
}
