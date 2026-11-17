import styles from "./workspace.module.css";
import { useState } from "react";
import { randomUUID } from "../../lib/utils";
import { serviceRequest } from "./services";
import { useServiceData } from "./useServiceData";
import { deliverToComposer, readStoredText, useChronosWorkspace } from "./state";

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  dueDate: string | null;
  labels: string[];
  order: number;
  checklist: { id: string; text: string; done: boolean }[];
  notes: { at: string; by: string; text: string }[];
}
interface Project {
  id: string;
  title: string;
  root: string;
}
interface Group {
  id: string;
  name: string;
  projectIds: string[];
}
export const TASK_STATUSES = {
  backlog: "Бэклог",
  doing: "В работе",
  review: "На проверке",
  done: "Готово",
};
const PRIORITIES = { urgent: "Срочно", high: "Высокий", normal: "Обычный", low: "Низкий" };

export function filterTasks(
  tasks: Task[],
  projects: string[] | null,
  query: string,
  status: string,
  priority: string,
  hideDone: boolean,
): Task[] {
  const needle = query.trim().toLocaleLowerCase();
  return tasks
    .filter(
      (task) =>
        (projects === null || projects.includes(task.projectId)) &&
        (!hideDone || task.status !== "done") &&
        (status === "all" || task.status === status) &&
        (priority === "all" || task.priority === priority) &&
        (!needle ||
          `${task.id} ${task.title} ${task.description} ${task.labels.join(" ")}`
            .toLocaleLowerCase()
            .includes(needle)),
    )
    .sort((a, b) => a.order - b.order);
}

function TaskEditor({
  task,
  projects,
  onSaved,
  onCancel,
}: {
  task: Task | null;
  projects: Project[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checklist, setChecklist] = useState(task?.checklist ?? []);
  const [checkText, setCheckText] = useState("");
  return (
    <form
      className={styles["chronos-task-editor"]}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        const body = {
          title: data.get("title"),
          projectId: data.get("projectId"),
          description: data.get("description"),
          status: data.get("status"),
          priority: data.get("priority"),
          dueDate: data.get("dueDate") || null,
          labels: String(data.get("labels") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          checklist,
          note: data.get("note"),
        };
        void serviceRequest("tasks", task ? `/api/tasks/${task.id}` : "/api/tasks", {
          method: task ? "PATCH" : "POST",
          body,
        }).then(onSaved, (reason) => {
          setError(String(reason));
          setBusy(false);
        });
      }}
    >
      <h3>{task ? `#${task.id}` : "Новая задача"}</h3>
      <label>
        Название
        <input name="title" required maxLength={300} defaultValue={task?.title} dir="auto" />
      </label>
      <label>
        Проект
        <select name="projectId" defaultValue={task?.projectId ?? projects[0]?.id}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      <div className={styles["chronos-row"]}>
        <label>
          Статус
          <select name="status" defaultValue={task?.status ?? "backlog"}>
            {Object.entries(TASK_STATUSES).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Приоритет
          <select name="priority" defaultValue={task?.priority ?? "normal"}>
            {Object.entries(PRIORITIES).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Описание
        <textarea name="description" rows={5} defaultValue={task?.description} dir="auto" />
      </label>
      <div className={styles["chronos-row"]}>
        <label>
          Срок
          <input name="dueDate" type="date" defaultValue={task?.dueDate ?? ""} />
        </label>
        <label>
          Метки через запятую
          <input name="labels" defaultValue={task?.labels.join(", ")} />
        </label>
      </div>
      <fieldset>
        <legend>Чек-лист</legend>
        {checklist.map((item, index) => (
          <label key={item.id} className={styles["chronos-row"]}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={(event) =>
                setChecklist(
                  checklist.map((row, i) =>
                    i === index ? { ...row, done: event.target.checked } : row,
                  ),
                )
              }
            />
            <span dir="auto">{item.text}</span>
            <button
              type="button"
              aria-label="Удалить пункт"
              onClick={() => setChecklist(checklist.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </label>
        ))}
        <div className={styles["chronos-row"]}>
          <input
            aria-label="Новый пункт"
            value={checkText}
            onChange={(event) => setCheckText(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (checkText.trim()) {
                setChecklist([
                  ...checklist,
                  { id: randomUUID(), text: checkText.trim(), done: false },
                ]);
                setCheckText("");
              }
            }}
          >
            Добавить пункт
          </button>
        </div>
      </fieldset>
      {task?.notes.map((note) => (
        <p dir="auto" key={`${note.at}-${note.by}-${note.text}`}>
          <strong>{note.by}</strong> · {note.at}
          <br />
          {note.text}
        </p>
      ))}
      <label>
        Комментарий
        <textarea name="note" rows={2} />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className={styles["chronos-row"]}>
        <button disabled={busy || !projects.length} type="submit">
          Сохранить
        </button>
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        {task && (
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              void serviceRequest("tasks", `/api/tasks/${task.id}`, { method: "DELETE" }).then(
                onSaved,
                (reason) => {
                  setError(String(reason));
                  setBusy(false);
                },
              );
            }}
          >
            В корзину
          </button>
        )}
      </div>
    </form>
  );
}

export function TaskBoard() {
  const tasks = useServiceData<Task[]>("tasks", "/api/tasks");
  const projects = useServiceData<Project[]>("tasks", "/api/projects");
  const groups = useServiceData<Group[]>("tasks", "/api/groups");
  const requested = useChronosWorkspace((state) => state.taskId);
  const [editing, setEditing] = useState<string | null>(requested);
  const [scope, setScope] = useState(() => {
    const value = readStoredText("oly-tasks-sel", "all");
    return value.startsWith("g:")
      ? "group:" + value.slice(2)
      : value.startsWith("p:")
        ? value.slice(2)
        : "all";
  });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [view, setView] = useState(() => readStoredText("oly-tasks-view", "board"));
  const [hideDone, setHideDone] = useState(false);
  const [error, setError] = useState("");
  const [groupEdit, setGroupEdit] = useState<Group | "new" | null>(null);
  const selectedProjects = scope.startsWith("group:")
    ? (groups.value?.find((group) => group.id === scope.slice(6))?.projectIds ?? [])
    : scope === "all"
      ? null
      : [scope];
  const visible = filterTasks(
    tasks.value ?? [],
    selectedProjects,
    query,
    status,
    priority,
    hideDone,
  );
  const refresh = () => {
    tasks.refresh();
    groups.refresh();
  };
  const move = (id: string, nextStatus: string, beforeId?: string) => {
    void serviceRequest("tasks", `/api/tasks/${id}/move`, {
      body: { status: nextStatus, beforeId },
    }).then(refresh, (reason) => setError(String(reason)));
  };
  if (
    editing &&
    editing !== "new" &&
    tasks.value &&
    !tasks.value.some((task) => task.id === editing)
  )
    return (
      <div role="alert">
        Задача #{editing} не найдена.<button onClick={() => setEditing(null)}>К списку</button>
      </div>
    );
  if (editing && tasks.value && projects.value)
    return (
      <TaskEditor
        key={editing}
        task={tasks.value?.find((task) => task.id === editing) ?? null}
        projects={projects.value ?? []}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    );
  return (
    <div className={styles["chronos-task-board"]}>
      <div className={styles["chronos-row"]}>
        <select
          aria-label="Проект или группа"
          value={scope}
          onChange={(event) => {
            const value = event.target.value;
            setScope(value);
            localStorage.setItem(
              "oly-tasks-sel",
              value === "all"
                ? "all"
                : value.startsWith("group:")
                  ? "g:" + value.slice(6)
                  : "p:" + value,
            );
          }}
        >
          <option value="all">Все проекты</option>
          {projects.value?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
          {groups.value?.map((group) => (
            <option key={group.id} value={`group:${group.id}`}>
              {group.name}
            </option>
          ))}
        </select>
        <button onClick={() => setEditing("new")}>Новая задача</button>
        <button onClick={refresh}>Обновить</button>
        <button
          onClick={() =>
            setGroupEdit(
              scope.startsWith("group:")
                ? (groups.value?.find((group) => group.id === scope.slice(6)) ?? "new")
                : "new",
            )
          }
        >
          Группы
        </button>
      </div>
      {groupEdit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void serviceRequest("tasks", "/api/groups", {
              method: "PUT",
              body: {
                ...(groupEdit === "new" ? {} : { id: groupEdit.id }),
                name: data.get("name"),
                projectIds: data.getAll("project"),
              },
            }).then(
              () => {
                setGroupEdit(null);
                refresh();
              },
              (reason) => setError(String(reason)),
            );
          }}
        >
          <label>
            Название группы
            <input name="name" required defaultValue={groupEdit === "new" ? "" : groupEdit.name} />
          </label>
          {projects.value?.map((project) => (
            <label key={project.id}>
              <input
                name="project"
                type="checkbox"
                value={project.id}
                defaultChecked={groupEdit !== "new" && groupEdit.projectIds.includes(project.id)}
              />
              {project.title}
            </label>
          ))}
          <button>Сохранить группу</button>
          <button type="button" onClick={() => setGroupEdit(null)}>
            Отмена
          </button>
          {groupEdit !== "new" && (
            <button
              type="button"
              onClick={() => {
                void serviceRequest("tasks", `/api/groups/${groupEdit.id}`, {
                  method: "DELETE",
                }).then(
                  () => {
                    setGroupEdit(null);
                    setScope("all");
                    refresh();
                  },
                  (reason) => setError(String(reason)),
                );
              }}
            >
              Удалить группу
            </button>
          )}
        </form>
      )}
      <div className={styles["chronos-row"]}>
        <input
          aria-label="Поиск задач"
          placeholder="Поиск задач"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Фильтр статуса"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">Все статусы</option>
          {Object.entries(TASK_STATUSES).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Фильтр приоритета"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="all">Все приоритеты</option>
          {Object.entries(PRIORITIES).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(event) => setHideDone(event.target.checked)}
          />
          Скрыть готовые
        </label>
        <button
          onClick={() => {
            const next = view === "board" ? "list" : "board";
            setView(next);
            localStorage.setItem("oly-tasks-view", next);
          }}
        >
          {view === "board" ? "Таблица" : "Доска"}
        </button>
      </div>
      {(error || tasks.error || projects.error || groups.error) && (
        <p role="alert">{error || tasks.error || projects.error || groups.error}</p>
      )}
      {!tasks.value && !tasks.error && <p>Загрузка задач…</p>}
      <div className={view === "board" ? styles["chronos-columns"] : styles["chronos-task-table"]}>
        {Object.entries(TASK_STATUSES).map(([id, label]) => (
          <section
            key={id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const taskId = event.dataTransfer.getData("application/x-chronos-task");
              if (taskId) move(taskId, id);
            }}
          >
            <h3>
              {label} · {visible.filter((task) => task.status === id).length}
            </h3>
            {visible
              .filter((task) => task.status === id)
              .map((task) => (
                <article
                  key={task.id}
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData("application/x-chronos-task", task.id)
                  }
                  onDrop={(event) => {
                    const taskId = event.dataTransfer.getData("application/x-chronos-task");
                    if (taskId) {
                      event.stopPropagation();
                      move(taskId, id, task.id);
                    }
                  }}
                >
                  <button onClick={() => setEditing(task.id)}>
                    <strong>#{task.id}</strong> <span dir="auto">{task.title}</span>
                  </button>
                  <p dir="auto">
                    {task.labels.join(" · ")}
                    {task.dueDate ? ` · ${task.dueDate}` : ""}
                  </p>
                  <p>
                    {task.checklist.filter((item) => item.done).length}/{task.checklist.length} ·{" "}
                    {PRIORITIES[task.priority as keyof typeof PRIORITIES] ?? task.priority}
                  </p>
                  <div className={styles["chronos-row"]}>
                    <select
                      aria-label={`Статус ${task.id}`}
                      value={task.status}
                      onChange={(event) => move(task.id, event.target.value)}
                    >
                      {Object.entries(TASK_STATUSES).map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        void deliverToComposer({ text: `#${task.id} ` }).then(
                          () => useChronosWorkspace.getState().close(),
                          (reason) => setError(String(reason)),
                        );
                      }}
                    >
                      В чат
                    </button>
                  </div>
                </article>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
