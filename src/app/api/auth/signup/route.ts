import { NextRequest, NextResponse } from "next/server";
import { db_queries } from "@/lib/db";
import { hashPassword, signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = body;

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Email, password, and name are required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const existing = db_queries.getUserByEmail(email.toLowerCase());
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const result = db_queries.createUser(email.toLowerCase(), passwordHash, name.trim());
    const userId = result.lastInsertRowid as number;

    const token = signToken({ userId, email: email.toLowerCase(), name: name.trim() });

    return NextResponse.json({
      token,
      user: { id: userId, email: email.toLowerCase(), name: name.trim() },
    });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
