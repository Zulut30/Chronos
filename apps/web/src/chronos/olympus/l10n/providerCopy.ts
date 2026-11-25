const effort = new Map([
  ["Low", "Низкий"], ["Medium", "Средний"], ["High", "Высокий"],
  ["Extra High", "Очень высокий"],
]);

export function effortLabel(label: string, locale: string): string {
  if (!locale.startsWith("ru")) return label;
  const parts = label.split(" · ");
  return parts.map((part, index) =>
    index === 0 && parts.length > 1 ? part : effort.get(part) ?? part,
  ).join(" · ");
}

const notices = new Map([
  ["Could not read limits.", "Не удалось получить лимиты."],
  ["Sign in with Google to see Antigravity limits.", "Войдите через Google, чтобы увидеть лимиты Antigravity."],
  ["Cursor could not read usage limits.", "Не удалось получить лимиты Cursor."],
  ["Grok could not read usage limits.", "Не удалось получить лимиты Grok."],
  ["OpenCode Go could not read usage.", "Не удалось получить данные об использовании OpenCode Go."],
]);

export function usageNotice(notice: string, locale: string): string {
  if (!locale.startsWith("ru")) return notice;
  const start = notice.lastIndexOf(": ") + 2;
  const offset = start === 1 ? 0 : start;
  const translated = notices.get(notice.slice(offset));
  return translated ? notice.slice(0, offset) + translated : notice;
}
