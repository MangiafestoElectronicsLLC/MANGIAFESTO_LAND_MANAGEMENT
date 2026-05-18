import { NextRequest, NextResponse } from "next/server";
import { db_queries } from "@/lib/db";
import { getTokenFromHeader, verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = getTokenFromHeader(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickets = db_queries.getAllTickets();
  return NextResponse.json({ tickets });
}

export async function POST(req: NextRequest) {
  const token = getTokenFromHeader(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, description, priority, role } = body;

    if (!title || !description || !priority || !role) {
      return NextResponse.json(
        { error: "Title, description, priority, and role are required" },
        { status: 400 }
      );
    }

    const validPriorities = ["low", "medium", "high", "urgent"];
    if (!validPriorities.includes(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    const validRoles = ["Chairman", "Legal", "Grounds", "Technology"];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const result = db_queries.createTicket(
      title.trim(),
      description.trim(),
      priority,
      role,
      payload.userId
    );
    const ticket = db_queries.getTicketById(result.lastInsertRowid as number);

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err) {
    console.error("Create ticket error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
