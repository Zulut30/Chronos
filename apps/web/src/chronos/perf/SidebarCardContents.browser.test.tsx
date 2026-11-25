import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { SidebarCardContents } from "./SidebarCardContents";

it("retains focused sidebar controls outside the viewport and restores the full card", async () => {
  const card = (visible: boolean) => <SidebarCardContents renderContents={visible} compact={false} title="Thread">
    <button>Open changes</button>
  </SidebarCardContents>;
  const view = await render(card(true));
  const button = page.getByRole("button", { name: "Open changes" });
  const element = button.element() as HTMLButtonElement;
  const height = element.parentElement!.getBoundingClientRect().height;
  element.focus();
  await view.rerender(card(false));
  expect(document.activeElement).toBe(element);
  element.blur();
  await expect.element(page.getByText("Thread", { exact: true })).toBeVisible();
  expect(document.querySelector("[data-sidebar-card-placeholder]")!.parentElement!.getBoundingClientRect().height).toBe(height);
  await expect.element(button).not.toBeInTheDocument();
  await view.rerender(card(true));
  await expect.element(button).toBeVisible();
});
