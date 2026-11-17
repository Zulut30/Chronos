import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { chronosMessageClipboard } from "./clipboard";
import {
  chatMarkdownClipboardPayload,
  serializeRenderedMarkdownFragment,
  serializeCodeBlockToMarkdown,
} from "../../markdown-clipboard";
import { MessageCopyButton } from "../../components/chat/MessageCopyButton";
import { AnchoredToastProvider } from "../../components/ui/toast";

it("copies a partial colored selection with fixed colors and rich ancestors", async () => {
  await using screen = await render(
    <div className="chat-markdown">
      <p>
        <span data-chronos-rich style={{ color: "var(--chronos-c-red,red)", fontWeight: "bold" }}>
          <u>Сохранить цвет</u>
        </span>
      </p>
    </div>,
  );
  const text = screen.container.querySelector("u")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 9);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    const payload = chatMarkdownClipboardPayload(selection)!;
    expect(payload.html).toContain("color:");
    expect(payload.html).toMatch(/#c62828|rgb\(198, 40, 40\)/i);
    expect(payload.html).toContain("font-weight:");
    expect(payload.html).toContain("<u");
    expect(payload.html).not.toContain("var(");
    expect(payload.html).not.toContain("data-chronos");
  } finally {
    selection.removeAllRanges();
  }
});

it("exports sanitized rich messages and leaves ordinary Markdown and literal code on upstream copy", () => {
  const copy = (text: string) =>
    chronosMessageClipboard(text, {
      fragment: serializeRenderedMarkdownFragment,
      codeBlock: serializeCodeBlockToMarkdown,
    });
  const payload = copy(
    '<span style="color:blue;background:yellow;font-style:italic" onclick="evil()">Привет</span> <mark>мир</mark>',
  )!;
  expect(payload.html).toMatch(/#1952c5|rgb\(25, 82, 197\)/i);
  expect(payload.html).toContain("font-style:");
  expect(payload.html).not.toContain("onclick");
  expect(payload.text.trim()).toBe("Привет мир");
  expect(copy("**upstream**")).toBeNull();
  expect(copy("`<mark>code</mark>`")).toBeNull();
});

it("the native message copy button writes both fixed-color HTML and readable plain text", async () => {
  const markdown =
    '<span style="color:green;font-weight:bold">Готово</span>\n\nВторая строка\n\n10. Первый\n11. Второй\n\n```ts\nconst value = 1;\n```';
  await using screen = await render(
    <AnchoredToastProvider timeout={0}>
      <MessageCopyButton text={markdown} />
    </AnchoredToastProvider>,
  );
  using write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue(undefined);
  await screen.getByRole("button", { name: "Copy message" }).click();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  const item = write.mock.calls[0]![0][0]!;
  expect(await (await item.getType("text/html")).text()).toMatch(/#2e7d32|rgb\(46, 125, 50\)/i);
  expect((await (await item.getType("text/plain")).text()).trim()).toBe(
    "Готово\n\nВторая строка\n\n10. Первый\n11. Второй\n\n```ts\nconst value = 1;\n```",
  );
});
