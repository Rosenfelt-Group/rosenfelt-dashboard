"use client";
import { useEffect, useState } from "react";
import { Task, TaskStatus, Agent } from "@/types";
import { AgentBadge } from "@/components/AgentBadge";
import { isPast, parseISO } from "date-fns";
import clsx from "clsx";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "open",        label: "Open" },
  { status: "in_progress", label: "In Progress" },
  { status: "done",        label: "Done" },
];

const PRIORITY_COLORS = {
  high:   "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low:    "bg-gray-100 text-gray-500",
};

function TaskCard({ task, onUpdate }: { task: Task; onUpdate: (id: string, updates: Partial<Task>) => void }) {
  const overdue = task.due_date && !["done","cancelled"].includes(task.status) && isPast(parseISO(task.due_date));

  return (
    <div className="bg-white rounded-lg border border-brand-border p-3 space-y-2">
      <p className="text-sm font-medium text-brand-black leading-snug">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <AgentBadge agent={task.assigned_agent} size="sm" />
        <span className={clsx("badge text-xs", PRIORITY_COLORS[task.priority])}>
          {task.priority}
        </span>
        {task.due_date && (
          <span className={clsx("text-xs", overdue ? "text-red-600 font-medium" : "text-brand-muted")}>
            {overdue ? "overdue · " : "due "}
            {new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
      {/* Status move buttons */}
      <div className="flex gap-1 pt-1">
        {COLUMNS.filter(c => c.status !== task.status).map(col => (
          <button
            key={col.status}
            onClick={() => onUpdate(task.id, { status: col.status })}
            className="text-xs px-2 py-1 rounded bg-brand-offwhite text-brand-muted
                       hover:bg-brand-border transition-colors"
          >
            → {col.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NewTaskForm({ onSave, onCancel }: { onSave: (t: Partial<Task>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState<Agent>("riley");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [dueDate, setDueDate] = useState("");

  return (
    <div className="bg-white rounded-lg border-2 border-brand-orange p-3 space-y-2">
      <input
        autoFocus
        className="w-full text-sm border border-brand-border rounded-lg px-3 py-2
                   focus:outline-none focus:border-brand-orange"
        placeholder="Task title..."
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && title.trim()) onSave({ title, assigned_agent: agent, priority, due_date: dueDate || undefined, status: "open" });
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex gap-2">
        <select
          value={agent}
          onChange={e => setAgent(e.target.value as Agent)}
          className="flex-1 text-xs border border-brand-border rounded px-2 py-1.5
                     focus:outline-none focus:border-brand-orange"
        >
          {(["riley","jordan","avery","brian"] as Agent[]).map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={priority}
          onChange={e => setPriority(e.target.value as Task["priority"])}
          className="flex-1 text-xs border border-brand-border rounded px-2 py-1.5
                     focus:outline-none focus:border-brand-orange"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="flex-1 text-xs border border-brand-border rounded px-2 py-1.5
                     focus:outline-none focus:border-brand-orange"
        />
      </div>
      <div className="flex gap-2">
        <button
          disabled={!title.trim()}
          onClick={() => title.trim() && onSave({ title, assigned_agent: agent, priority, due_date: dueDate || undefined, status: "open" })}
          className="btn-primary text-xs py-1.5 disabled:opacity-40"
        >
          Add task
        </button>
        <button onClick={onCancel} className="btn-ghost text-xs py-1.5">Cancel</button>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [tasks,       setTasks]       = useState<Task[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [adding,      setAdding]      = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<TaskStatus>>(
    new Set(["open", "in_progress", "done"] as TaskStatus[])
  );

  useEffect(() => {
    fetch("/api/tasks")
      .then(r => r.json())
      .then(d => { setTasks(d); setLoading(false); });
  }, []);

  async function handleCreate(partial: Partial<Task>) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    const task = await res.json();
    setTasks(prev => [task, ...prev]);
    setAdding(false);
  }

  async function handleUpdate(id: string, updates: Partial<Task>) {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    const updated = await res.json();
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
  }

  const byStatus = (status: TaskStatus) => tasks.filter(t => t.status === status);

  if (loading) {
    return (
      <div className="p-8">
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="card animate-pulse h-64" />)}
        </div>
      </div>
    );
  }

  const visibleColumns = COLUMNS.filter(c => visibleCols.has(c.status));

  function toggleCol(status: TaskStatus) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(status) && next.size > 1) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Tasks</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            {tasks.filter(t => t.status !== "done").length} active ·{" "}
            {tasks.filter(t => t.status === "done").length} done
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Column toggles */}
          <div className="flex gap-1 border border-brand-border rounded-lg p-1">
            {COLUMNS.map(col => (
              <button
                key={col.status}
                onClick={() => toggleCol(col.status)}
                className={clsx(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  visibleCols.has(col.status)
                    ? "bg-brand-orange text-white"
                    : "text-brand-muted hover:bg-brand-offwhite"
                )}>
                {col.label}
              </button>
            ))}
          </div>
          <button onClick={() => setAdding(true)} className="btn-primary">
            + Add task
          </button>
        </div>
      </div>

      <div className={clsx(
        "grid gap-4",
        visibleColumns.length === 3 ? "grid-cols-1 md:grid-cols-3" :
        visibleColumns.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:max-w-sm"
      )}>
        {visibleColumns.map(col => (
          <div key={col.status}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-brand-black">{col.label}</h2>
              <span className="text-xs text-brand-muted bg-brand-border px-2 py-0.5 rounded-full">
                {byStatus(col.status).length}
              </span>
            </div>

            <div className="space-y-2">
              {col.status === "open" && adding && (
                <NewTaskForm onSave={handleCreate} onCancel={() => setAdding(false)} />
              )}

              {byStatus(col.status).length === 0 && !(col.status === "open" && adding) && (
                <div className="border-2 border-dashed border-brand-border rounded-lg p-4 text-center">
                  <p className="text-xs text-brand-muted">No {col.label.toLowerCase()} tasks</p>
                </div>
              )}

              {byStatus(col.status).map(task => (
                <TaskCard key={task.id} task={task} onUpdate={handleUpdate} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
