import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AnchoredToastProvider } from "../ui/toast";
import { AboutVersionTitle } from "./AboutVersionTitle";

it("copies the version without a notification", async () => {
  const version = "0.1.14-nightly.20261127.5319.chronos.18";
  await using screen = await render(
    <AnchoredToastProvider>
      <AboutVersionTitle version={version} />
    </AnchoredToastProvider>,
  );
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  await screen.getByRole("button", { name: `Copy version ${version}` }).click();

  expect(write).toHaveBeenCalledWith(version);
  await expect.element(page.getByText(/^Copied!?$/)).not.toBeInTheDocument();
});
