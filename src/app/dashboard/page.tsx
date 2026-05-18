"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import TicketCard from "@/components/TicketCard";
import TicketDetail from "@/components/TicketDetail";
import NewTicketForm from "@/components/NewTicketForm";
import type { Ticket } from "@/lib/db";

const ROLES = ["All", "Chairman", "Legal", "Grounds", "Technology"] as const;
const STATUSES = ["All", "open", "in_progress", "closed"] as const;

const STATUS_LABEL: Record<string, string> = {
  All: "All",
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
};

export default function DashboardPage() {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [fetchingTickets, setFetchingTickets] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // Filters
  const [roleFilter, setRoleFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const loadTickets = useCallback(async () => {
    if (!token) return;
    setFetchingTickets(true);
    setFetchError("");
    try {
      const res = await fetch("/api/tickets", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load tickets");
      setTickets(data.tickets);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setFetchingTickets(false);
    }
  }, [token]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/auth");
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    if (user && token) {
      loadTickets();
    }
  }, [user, token, loadTickets]);

  function handleTicketCreated(ticket: Ticket) {
    setTickets((prev) => [ticket, ...prev]);
    setShowNewForm(false);
  }

  function handleTicketUpdated(updated: Ticket) {
    setTickets((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
    setSelectedTicket(updated);
  }

  function handleTicketDeleted(id: number) {
    setTickets((prev) => prev.filter((t) => t.id !== id));
    setSelectedTicket(null);
  }

  const filtered = tickets.filter((t) => {
    if (roleFilter !== "All" && t.role !== roleFilter) return false;
    if (statusFilter !== "All" && t.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !t.title.toLowerCase().includes(q) &&
        !t.description.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  // Stats
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;
  const closedCount = tickets.filter((t) => t.status === "closed").length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Welcome + New Ticket */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Welcome back, {user.name}
            </p>
          </div>
          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">New Ticket</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
          <StatCard
            label="Open"
            count={openCount}
            color="text-green-600"
            bg="bg-green-50"
            onClick={() => setStatusFilter("open")}
          />
          <StatCard
            label="In Progress"
            count={inProgressCount}
            color="text-yellow-600"
            bg="bg-yellow-50"
            onClick={() => setStatusFilter("in_progress")}
          />
          <StatCard
            label="Closed"
            count={closedCount}
            color="text-gray-500"
            bg="bg-gray-50"
            onClick={() => setStatusFilter("closed")}
          />
        </div>

        {/* Search & Filters */}
        <div className="space-y-3 mb-6">
          <input
            type="search"
            placeholder="Search tickets…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          />
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs font-medium text-gray-500 mr-1">Role:</span>
              {ROLES.map((r) => (
                <FilterChip
                  key={r}
                  label={r}
                  active={roleFilter === r}
                  onClick={() => setRoleFilter(r)}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs font-medium text-gray-500 mr-1">Status:</span>
              {STATUSES.map((s) => (
                <FilterChip
                  key={s}
                  label={STATUS_LABEL[s]}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Ticket List */}
        {fetchingTickets ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : fetchError ? (
          <div className="text-center py-16">
            <p className="text-red-500 text-sm mb-4">{fetchError}</p>
            <button
              onClick={loadTickets}
              className="text-sm text-green-600 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-500 font-medium">No tickets found</p>
            {tickets.length === 0 ? (
              <p className="text-gray-400 text-sm mt-1">
                Create your first ticket to get started
              </p>
            ) : (
              <button
                onClick={() => {
                  setRoleFilter("All");
                  setStatusFilter("All");
                  setSearchQuery("");
                }}
                className="mt-3 text-sm text-green-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onClick={() => setSelectedTicket(ticket)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      {showNewForm && token && (
        <NewTicketForm
          token={token}
          onCreated={handleTicketCreated}
          onClose={() => setShowNewForm(false)}
        />
      )}

      {selectedTicket && token && (
        <TicketDetail
          ticket={selectedTicket}
          token={token}
          onClose={() => setSelectedTicket(null)}
          onUpdate={handleTicketUpdated}
          onDelete={handleTicketDeleted}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  count,
  color,
  bg,
  onClick,
}: {
  label: string;
  count: number;
  color: string;
  bg: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`${bg} rounded-xl p-3 sm:p-4 text-left hover:opacity-90 transition-opacity`}
    >
      <p className={`text-2xl sm:text-3xl font-bold ${color}`}>{count}</p>
      <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{label}</p>
    </button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
        active
          ? "bg-green-600 text-white border-green-600"
          : "bg-white text-gray-600 border-gray-200 hover:border-green-400"
      }`}
    >
      {label}
    </button>
  );
}
