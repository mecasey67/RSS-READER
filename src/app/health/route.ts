import { NextResponse } from "next/server";
import { rawSqlite } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    rawSqlite.prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return NextResponse.json({ status: "error", message: (err as Error).message }, { status: 503 });
  }
}
