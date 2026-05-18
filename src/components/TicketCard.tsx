"use client";

import type { Ticket } from "@/lib/db";

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-green-100 text-green-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  closed: "bg-gray-100 text-gray-500",
};

const ROLE_COLORS: Record<string, string> = {
  Chairman: "bg-purple-100 text-purple-700",
  Legal: "bg-indigo-100 text-indigo-700",
  Grounds: "bg-emerald-100 text-emerald-700",
  Technology: "bg-cyan-100 text-cyan-700",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusLabel({ status }: { status: string }) {
  const label =
    status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? ""}`}>
      {label}
    </span>
  );
}

type TicketCardProps = {
  ticket: Ticket;
  onClick: () => void;
};

export default function TicketCard({ ticket, onClick }: TicketCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-green-400 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-green-500"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-gray-900 leading-tight line-clamp-2">
          {ticket.title}
        </h3>
        <StatusLabel status={ticket.status} />
      </div>

      <p className="text-sm text-gray-500 line-clamp-2 mb-3">
        {ticket.description}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[ticket.role] ?? ""}`}
        >
          {ticket.role}
        </span>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_STYLES[ticket.priority] ?? ""}`}
        >
          {ticket.priority}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {formatDate(ticket.created_at)}
        </span>
      </div>

      {ticket.creator_name && (
        <div className="mt-2 text-xs text-gray-400">
          Submitted by {ticket.creator_name}
        </div>
      )}
    </button>
  );
}
