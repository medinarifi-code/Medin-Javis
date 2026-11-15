import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "goals.json");

export function createGoalStore(file = DEFAULT_FILE) {
  async function load() {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  async function save(goals) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(goals, null, 2));
  }

  function find(goals, id) {
    const goal = goals.find((g) => g.id === id || g.id.startsWith(id));
    if (!goal) throw new Error(`Ziel mit ID "${id}" nicht gefunden.`);
    return goal;
  }

  return {
    list: load,

    async add({ title, description = "", deadline = null }) {
      if (!title || !title.trim()) throw new Error("Ein Ziel braucht einen Titel.");
      const goals = await load();
      const goal = {
        id: randomUUID().slice(0, 8),
        title: title.trim(),
        description,
        deadline,
        progress: 0,
        status: "aktiv",
        notes: [],
        createdAt: new Date().toISOString(),
      };
      goals.push(goal);
      await save(goals);
      return goal;
    },

    async update({ id, progress, status, note, title, deadline }) {
      const goals = await load();
      const goal = find(goals, id);
      if (typeof progress === "number") goal.progress = Math.max(0, Math.min(100, Math.round(progress)));
      if (status) goal.status = status;
      if (title) goal.title = title;
      if (deadline !== undefined) goal.deadline = deadline;
      if (note) goal.notes.push({ text: note, at: new Date().toISOString() });
      if (goal.progress === 100 && !status) goal.status = "erreicht";
      goal.updatedAt = new Date().toISOString();
      await save(goals);
      return goal;
    },

    async remove({ id }) {
      const goals = await load();
      const goal = find(goals, id);
      await save(goals.filter((g) => g !== goal));
      return { removed: goal.title };
    },
  };
}
