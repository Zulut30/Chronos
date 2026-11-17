import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { StudioPanel } from "./StudioPanel";
import { TaskBoard } from "./TaskBoard";
import { ChronosPlanControl } from "./planMode";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import {
  registerChronosComposer,
  registerChronosSettingsNavigation,
  useChronosWorkspace,
} from "./state";
import { ChronosLauncher } from "./ChronosLauncher";
import { serviceFrameUrl } from "./services";

it("creates a board from one chooser and sends its editor to native preview", async () => {
  useChronosWorkspace.setState({ error: "" });
  using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    if (path.endsWith("/api/locations"))
      return Response.json({
        locations: [{ id: "test", title: "Проект", dir: "C:/isolated/.excalidraw", current: true }],
      });
    if (path.endsWith("/api/boards")) return Response.json({ boards: [] });
    if (path.endsWith("/api/board/create")) {
      expect(JSON.parse(String(init?.body))).toEqual({
        dir: "C:/isolated/.excalidraw",
        name: "Новая схема",
      });
      return Response.json({ path: "C:/isolated/.excalidraw/Новая схема.excalidraw" });
    }
    throw Error(`Unexpected request ${path}`);
  });
  const deliveries: unknown[] = [];
  const unregister = registerChronosComposer("test", async (delivery) => {
    deliveries.push(delivery);
  });
  try {
    await using screen = await render(<StudioPanel />);
    await screen.getByRole("textbox", { name: "Название новой доски" }).fill("Новая схема");
    await expect.element(screen.getByRole("button", { name: "Создать доску" })).toBeEnabled();
    await screen.getByRole("button", { name: "Создать доску" }).click();
    await vi.waitFor(() => expect(deliveries).toHaveLength(1));
    expect(deliveries[0]).toMatchObject({
      text: "",
      previewUrl: expect.stringContaining("/board?path=C%3A%2Fisolated%2F.excalidraw%2F"),
    });
    expect(screen.container.querySelector("iframe")).toBeNull();
  } finally {
    unregister();
  }
});

it("edits an existing task through the service without dropping its checklist, notes or project", async () => {
  useChronosWorkspace.setState({ taskId: "T-7" });
  const task = {
    id: "T-7",
    projectId: "p1",
    title: "Старая",
    description: "Описание",
    status: "doing",
    priority: "high",
    dueDate: "2026-11-20",
    labels: ["важно"],
    order: 1,
    checklist: [{ id: "c1", text: "Сохранить", done: true }],
    notes: [{ at: "2026-11-17", by: "test", text: "История" }],
  };
  const writes: unknown[] = [];
  using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    if (init?.method === "PATCH") {
      writes.push(JSON.parse(String(init.body)));
      return Response.json(task);
    }
    if (path.endsWith("/api/projects"))
      return Response.json([{ id: "p1", title: "Проект", root: "C:/isolated" }]);
    if (path.endsWith("/api/groups")) return Response.json([]);
    if (path.endsWith("/api/tasks")) return Response.json([task]);
    throw Error(`Unexpected request ${path}`);
  });
  await using screen = await render(<TaskBoard />);
  await expect
    .element(screen.getByRole("option", { name: "Проект", exact: true }))
    .toBeInTheDocument();
  await screen.getByRole("textbox", { name: "Название", exact: true }).fill("Обновлённая");
  await screen.getByRole("button", { name: "Сохранить", exact: true }).click();
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    title: "Обновлённая",
    projectId: "p1",
    status: "doing",
    priority: "high",
    dueDate: "2026-11-20",
    labels: ["важно"],
    checklist: task.checklist,
  });
  useChronosWorkspace.setState({ taskId: null });
});

it("keeps Plan attached to each draft when switching composers and clearing sent content", async () => {
  const a = DraftId.make("browser-plan-a"),
    b = DraftId.make("browser-plan-b");
  const store = useComposerDraftStore.getState();
  store.setPrompt(a, "A");
  store.setPrompt(b, "B");
  store.setInteractionMode(a, "default");
  store.setInteractionMode(b, "default");
  await using screen = await render(<ChronosPlanControl target={a} />);
  await screen.getByRole("button", { name: "Plan", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Plan", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await screen.rerender(<ChronosPlanControl target={b} />);
  await expect
    .element(screen.getByRole("button", { name: "Plan", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  store.clearComposerContent(a);
  await screen.rerender(<ChronosPlanControl target={a} />);
  await expect
    .element(screen.getByRole("button", { name: "Plan", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
});

it("routes MCP into Settings without opening another workspace overlay and hides its embedded header", async () => {
  useChronosWorkspace.setState({ panel: null });
  const navigation: string[] = [];
  const unregister = registerChronosSettingsNavigation((panel) => navigation.push(panel));
  try {
    await using screen = await render(<ChronosLauncher panel="mcp" label="Серверы MCP" />);
    await screen.getByRole("button", { name: "Серверы MCP", exact: true }).click();
    expect(navigation).toEqual(["mcp"]);
    expect(useChronosWorkspace.getState().panel).toBeNull();
    expect(
      new URLSearchParams(new URL(serviceFrameUrl("mcp", "/", "dark")).hash.slice(1)).get(
        "embedded",
      ),
    ).toBe("settings");
  } finally {
    unregister();
  }
});
