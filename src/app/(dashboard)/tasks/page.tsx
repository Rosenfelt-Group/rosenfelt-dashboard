"use client";
import { useEffect, useState } from "react";
import { Task, TaskStatus, TaskPriority, Agent } from "@/types";
import { AgentBadge } from "@/components/AgentBadge";
import { isPast, parseISO } from "date-fns";
import clsx from "clsx";

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "open",        label: "Open",       color: "text-brand-black" },
  { status: "in_progress", label: "In Progress", color: "text-amber-600"  },
  { status: "deferred",    label: "Deferred",    color: "text-blue-500"   },
  { status: "done",        label: "Done",        color: "text-green-600"  },
];

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high:   "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low:    "bg-gray-100 text-gray-500",
};

// ─── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({ task, onSave, onClose }: {
  task: Task;
  onSave: (id: string, updates: Partial<Task>) => Promise<void>;
  onClose: () => void;
}) {
  const [title,       setTitle]       = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [notes,       setNotes]       = useState(task.notes ?? "");
  const [agent,       setAgent]       = useState<Agent>(task.assigned_agent);
  const [priority,    setPriority]    = useState<TaskPriority>(task.priority);
  const [status,      setStatus]      = useState<TaskStatus>(task.status);
  const [dueDate,     setDueDate]     = useState(task.due_date ?? "");
  const [category,    setCategory]    = useState(task.category ?? "");
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(task.id, {
      title:          title.trim(),
      description:    description.trim() || undefined,
      notes:          notes.trim() || undefined,
      assigned_agent: agent,
      priority,
      status,
      due_date:       dueDate || undefined,
      category:       category.trim() || undefined,
    });
    setSaving(false);
    onClose();
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-white w-full md:max-w-lg md:rounded-xl rounded-t-2xl shadow-xl flex flex-col max-h-[90vh]">

        {/* Mobile drag handle */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-brand-border rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
          <h2 className="text-base font-semibold text-brand-black">Edit Task</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-brand-muted hover:bg-brand-offwhite transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Scrollable form */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Title</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
              placeholder="Task title..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange resize-none"
              placeholder="Optional description..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange resize-none"
              placeholder="Internal notes..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Agent</label>
              <select
                value={agent}
                onChange={e => setAgent(e.target.value as Agent)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
              >
                {(["riley","jordan","avery","brian","sam"] as Agent[]).map(a =>
                  <option key={a} value={a}>{a}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as TaskPriority)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as TaskStatus)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
              >
                {COLUMNS.map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Category</label>
            <input
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
              placeholder="e.g. Website, Agent Development..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-brand-border flex gap-2">
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onClose} className="btn-ghost px-5">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onUpdate, onDelete, onEdit }: {
  task: Task;
  onUpdate: (id: string, updates: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => void;
  onEdit:   (task: Task) => void;
}) {
  const [expanded,   setExpanded]   = useState(false);
  const [confirming, setConfirming] = useState(false);
  const overdue = task.due_date &&
    !["done","cancelled","deferred"].includes(task.status) &&
    isPast(parseISO(task.due_date));
  const otherStatuses = COLUMNS.filter(c => c.status !== task.status);

  return (
    <div className="bg-white rounded-lg border border-brand-border p-3 space-y-2">
      <button className="w-full text-left" onClick={() => setExpanded(!expanded)}>
        <p className="text-sm font-medium text-brand-black leading-snug">{task.title}</p>
      </button>

      <div className="flex items-center gap-2 flex-wrap">
        <AgentBadge agent={task.assigned_agent} size="sm" />
        <span className={clsx("badge text-xs", PRIORITY_COLORS[task.priority])}>{task.priority}</span>
        {task.due_date && (
          <span className={clsx("text-xs", overdue ? "text-red-600 font-medium" : "text-brand-muted")}>
            {overdue ? "overdue · " : "due "}
            {new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
        {task.category && <span className="text-xs text-brand-muted">{task.category}</span>}
      </div>

      {expanded && (
        <div className="pt-1 space-y-2">
          {task.description && <p className="text-xs text-brand-muted">{task.description}</p>}
          {task.notes && <p className="text-xs text-brand-muted italic">{task.notes}</p>}

          {/* Quick status moves */}
          <div className="flex gap-1 flex-wrap">
            {otherStatuses.map(col => (
              <button
                key={col.status}
                onClick={() => onUpdate(task.id, { status: col.status })}
                className="text-xs px-2 py-1 rounded bg-brand-offwhite text-brand-muted hover:bg-brand-border transition-colors"
              >
                → {col.label}
              </button>
            ))}
          </div>

          {/* Edit + Delete */}
          <div className="pt-1 border-t border-brand-border flex items-center justify-between">
            <button
              onClick={() => onEdit(task)}
              className="text-xs text-brand-orange hover:text-orange-700 font-medium transition-colors"
            >
              ✏️ Edit
            </button>
            {confirming ? (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-red-600">Delete?</span>
                <button
                  onClick={() => { onDelete(task.id); setConfirming(false); }}
                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                >Yes</button>
                <button
                  onClick={() => setConfirming(false)}
                  className="text-xs px-2 py-1 rounded bg-brand-offwhite text-brand-muted transition-colors"
                >No</button>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:text-red-700 transition-colors">
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Task Form ─────────────────────────────────────────────────────────────

function NewTaskForm({ onSave, onCancel }: { onSave: (t: Partial<Task>) => void; onCancel: () => void }) {
  const [title,    setTitle]    = useState("");
  const [agent,    setAgent]    = useState<Agent>("riley");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate,  setDueDate]  = useState("");

  return (
    <div className="bg-white rounded-lg border-2 border-brand-orange p-3 space-y-2">
      <input
        autoFocus
        className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
        placeholder="Task title..."
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && title.trim()) onSave({ title, assigned_agent: agent, priority, due_date: dueDate || undefined, status: "open" });
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex gap-2">
        <select value={agent} onChange={e => setAgent(e.target.value as Agent)}
          className="flex-1 text-xs border border-brand-border rounded px-2 py-1.5 focus:outline-none focus:border-brand-orange">
          {(["riley","jordan","avery","brian"] as Agent[]).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}
          className="flex-1 text-xs border border-brand-border rounded px-2 py-1.5 focus:outline-none focus:border-brand-orange">
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className="flex-1 text-xs border border-brand-border rounded px-2 py-1.5 focus:outline-none focus:border-brand-orange" />
      </div>
      <div className="flex gap-2">
        <button disabled={!title.trim()}
          onClick={() => title.trim() && onSave({ title, assigned_agent: agent, priority, due_date: dueDate || undefined, status: "open" })}
          className="btn-primary text-xs py-1.5 disabled:opacity-40">Add task</button>
        <button onClick={onCancel} className="btn-ghost text-xs py-1.5">Cancel</button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks,     setTasks]     = useState<Task[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [adding,    setAdding]    = useState(false);
  const [filter,    setFilter]    = useState<Agent | "all">("all");
  const [mobileTab, setMobileTab] = useState<TaskStatus>("open");
  const [editing,   setEditing]   = useState<Task | null>(null);

  useEffect(() => {
    fetch("/api/tasks")
      .then(r => r.json())
      .then(d => { setTasks(d); setLoading(false); });
  }, []);

  async function handleCreate(partial: Partial<Task>) {
    const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(partial) });
    const task = await res.json();
    setTasks(prev => [task, ...prev]);
    setAdding(false);
  }

  async function handleUpdate(id: string, updates: Partial<Task>) {
    const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) });
    const updated = await res.json();
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
  }

  async function handleDelete(id: string) {
    await fetch("/api/tasks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  const filtered = filter === "all" ? tasks : tasks.filter(t => t.assigned_agent === filter);
  const byStatus = (status: TaskStatus) => filtered.filter(t => t.status === status);
  const agents: (Agent | "all")[] = ["all", "riley", "jordan", "avery", "brian"];

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="hidden md:grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="card animate-pulse h-64" />)}</div>
        <div className="md:hidden space-y-2">{[1,2,3].map(i => <div key={i} className="card animate-pulse h-20" />)}</div>
      </div>
    );
  }

  return (
    <>
      {editing && <EditModal task={editing} onSave={handleUpdate} onClose={() => setEditing(null)} />}

      {/* ── MOBILE ── */}
      <div className="md:hidden flex flex-col h-full pt-12 pb-20">
        <div className="px-4 pt-4 pb-2 bg-white border-b border-brand-border">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold text-brand-black">Tasks</h1>
              <p className="text-xs text-brand-muted">
                {tasks.filter(t => t.status === "open" || t.status === "in_progress").length} active ·{" "}
                {tasks.filter(t => t.status === "done").length} done
              </p>
            </div>
            <button onClick={() => setAdding(true)} className="btn-primary text-sm px-3 py-1.5">+ Add</button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
            {agents.map(a => (
              <button key={a} onClick={() => setFilter(a)}
                className={clsx("px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors capitalize flex-shrink-0",
                  filter === a ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted")}>
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="flex border-b border-brand-border bg-white">
          {COLUMNS.map(col => {
            const active = mobileTab === col.status;
            return (
              <button key={col.status} onClick={() => setMobileTab(col.status)}
                className={clsx("flex-1 py-2.5 text-xs font-medium transition-colors relative", active ? col.color : "text-brand-muted")}>
                {col.label}
                <span className={clsx("ml-1 text-[10px] px-1 rounded-full", active ? "bg-brand-border" : "")}>
                  {byStatus(col.status).length}
                </span>
                {active && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-brand-orange rounded-full" />}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-brand-offwhite">
          {mobileTab === "open" && adding && <NewTaskForm onSave={handleCreate} onCancel={() => setAdding(false)} />}
          {byStatus(mobileTab).length === 0 && !(mobileTab === "open" && adding) ? (
            <div className="border-2 border-dashed border-brand-border rounded-lg p-8 text-center mt-4">
              <p className="text-sm text-brand-muted">No {COLUMNS.find(c => c.status === mobileTab)?.label.toLowerCase()} tasks</p>
              {mobileTab === "open" && <button onClick={() => setAdding(true)} className="mt-2 text-xs text-brand-orange">+ Add one</button>}
            </div>
          ) : (
            byStatus(mobileTab).map(task => (
              <TaskCard key={task.id} task={task} onUpdate={handleUpdate} onDelete={handleDelete} onEdit={setEditing} />
            ))
          )}
        </div>
      </div>

      {/* ── DESKTOP ── */}
      <div className="hidden md:block p-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-brand-black">Tasks</h1>
            <p className="text-sm text-brand-muted mt-0.5">
              {tasks.filter(t => t.status === "open" || t.status === "in_progress").length} active ·{" "}
              {tasks.filter(t => t.status === "done").length} done ·{" "}
              {tasks.filter(t => t.status === "deferred").length} deferred
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {agents.map(a => (
                <button key={a} onClick={() => setFilter(a)}
                  className={clsx("px-2.5 py-1 rounded-full text-xs transition-colors capitalize",
                    filter === a ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
                  {a}
                </button>
              ))}
            </div>
            <button onClick={() => setAdding(true)} className="btn-primary">+ Add task</button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {COLUMNS.map(col => (
            <div key={col.status}>
              <div className="flex items-center justify-between mb-3">
                <h2 className={clsx("text-sm font-medium", col.color)}>{col.label}</h2>
                <span className="text-xs text-brand-muted bg-brand-border px-2 py-0.5 rounded-full">{byStatus(col.status).length}</span>
              </div>
              <div className="space-y-2">
                {col.status === "open" && adding && <NewTaskForm onSave={handleCreate} onCancel={() => setAdding(false)} />}
                {byStatus(col.status).length === 0 && !(col.status === "open" && adding) && (
                  <div className="border-2 border-dashed border-brand-border rounded-lg p-4 text-center">
                    <p className="text-xs text-brand-muted">No {col.label.toLowerCase()} tasks</p>
                  </div>
                )}
                {byStatus(col.status).map(task => (
                  <TaskCard key={task.id} task={task} onUpdate={handleUpdate} onDelete={handleDelete} onEdit={setEditing} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}