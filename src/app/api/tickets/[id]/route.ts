import { NextRequest, NextResponse } from "next/server";
import { db_queries } from "@/lib/db";
import { getTokenFromHeader, verifyToken } from "@/lib/auth";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  const token = getTokenFromHeader(req.headers.get("authorization"));
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticket = db_queries.getTicketById(Number(id));
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const token = getTokenFromHeader(req.headers.get("authorization"));
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticketId = Number(id);

  try {
    const body = await req.json();
    const { title, description, priority, role, status } = body;

    const validStatuses = ["open", "in_progress", "closed"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const validPriorities = ["low", "medium", "high", "urgent"];
    if (priority && !validPriorities.includes(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    const validRoles = ["Chairman", "Legal", "Grounds", "Technology"];
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const existing = db_queries.getTicketById(ticketId);
    if (!existing) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    db_queries.updateTicket(
      ticketId,
      title?.trim() ?? existing.title,
      description?.trim() ?? existing.description,
      priority ?? existing.priority,
      role ?? existing.role,
      status ?? existing.status
    );

    const updated = db_queries.getTicketById(ticketId);
    return NextResponse.json({ ticket: updated });
  } catch (err) {
    console.error("Update ticket error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const token = getTokenFromHeader(req.headers.get("authorization"));
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticketId = Number(id);

  const existing = db_queries.getTicketById(ticketId);
  if (!existing) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  db_queries.deleteTicket(ticketId);
  return NextResponse.json({ message: "Ticket deleted" });
}
