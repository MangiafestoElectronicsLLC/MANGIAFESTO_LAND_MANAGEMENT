"use client";

import { useState } from "react";
import type { Ticket } from "@/lib/db";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

const ROLE_COLORS: Record<string, string> = {
  Chairman: "bg-purple-100 text-purple-700",
  Legal: "bg-indigo-100 text-indigo-700",
  Grounds: "bg-emerald-100 text-emerald-700",
  Technology: "bg-cyan-100 text-cyan-700",
};

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type TicketDetailProps = {
  ticket: Ticket;
  onClose: () => void;
  onUpdate: (updated: Ticket) => void;
  onDelete: (id: number) => void;
  token: string;
};

export default function TicketDetail({
  ticket,
  onClose,
  onUpdate,
  onDelete,
  token,
}: TicketDetailProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [priority, setPriority] = useState(ticket.priority);
  const [role, setRole] = useState(ticket.role);
  const [status, setStatus] = useState(ticket.status);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, description, priority, role, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update ticket");
      onUpdate(data.ticket);
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setStatus(newStatus as typeof status);
      onUpdate(data.ticket);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this ticket? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      onDelete(ticket.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="font-semibold text-gray-900">
            Ticket #{ticket.id}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Status Quick-Change */}
          {!editing && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Status
              </p>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStatusChange(opt.value)}
                    disabled={saving || status === opt.value}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                      status === opt.value
                        ? "bg-green-600 text-white border-green-600"
                        : "bg-white text-gray-600 border-gray-300 hover:border-green-400 hover:text-green-600"
                    } disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ticket Content */}
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof priority)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Role
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as typeof role)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option>Chairman</option>
                    <option>Legal</option>
                    <option>Grounds</option>
                    <option>Technology</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Title
                </p>
                <p className="text-gray-900 font-medium">{ticket.title}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Description
                </p>
                <p className="text-gray-700 text-sm whitespace-pre-wrap">{ticket.description}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Priority
                  </p>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize ${PRIORITY_STYLES[ticket.priority]}`}
                  >
                    {ticket.priority}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Assigned Role
                  </p>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[ticket.role]}`}
                  >
                    {ticket.role}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="border-t border-gray-100 pt-3 space-y-1 text-xs text-gray-400">
            <p>Created: {formatDateTime(ticket.created_at)}</p>
            <p>Updated: {formatDateTime(ticket.updated_at)}</p>
            <p>Status changed: {formatDateTime(ticket.status_changed_at)}</p>
            {ticket.creator_name && <p>By: {ticket.creator_name}</p>}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex gap-3">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 px-4 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setTitle(ticket.title);
                  setDescription(ticket.description);
                  setPriority(ticket.priority);
                  setRole(ticket.role);
                  setStatus(ticket.status);
                }}
                className="py-2.5 px-4 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="flex-1 py-2.5 px-4 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="py-2.5 px-4 rounded-lg bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
