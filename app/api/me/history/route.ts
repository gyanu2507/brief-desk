import { NextResponse } from "next/server";
import {
  HISTORY_MAX,
  type BriefHistoryEntry,
} from "../../../../lib/brief-history";
import { isSupabaseConfigured } from "../../../../lib/supabase/config";
import { createClient } from "../../../../lib/supabase/server";

function asEntry(row: { id: string; at: number; payload: unknown }): BriefHistoryEntry | null {
  const p = row.payload;
  if (!p || typeof p !== "object") return null;
  const entry = { ...(p as BriefHistoryEntry), id: row.id, at: row.at };
  if (typeof entry.markdown !== "string") return null;
  return entry;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "supabase_disabled" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("brief_history")
    .select("id, at, payload")
    .eq("user_id", user.id)
    .order("at", { ascending: false })
    .limit(HISTORY_MAX);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = (data || [])
    .map(asEntry)
    .filter((e): e is BriefHistoryEntry => Boolean(e));

  return NextResponse.json({ entries });
}

export async function PUT(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "supabase_disabled" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { entries?: BriefHistoryEntry[] };
  try {
    body = (await request.json()) as { entries?: BriefHistoryEntry[] };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw = Array.isArray(body.entries) ? body.entries : [];
  const capped = raw
    .filter((e) => e && typeof e.id === "string" && typeof e.markdown === "string")
    .slice(0, HISTORY_MAX);

  const rows = capped.map((e) => ({
    user_id: user.id,
    id: e.id,
    at: typeof e.at === "number" ? e.at : Date.now(),
    payload: e,
  }));

  const { data: existing, error: listErr } = await supabase
    .from("brief_history")
    .select("id")
    .eq("user_id", user.id);
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase.from("brief_history").upsert(rows, {
      onConflict: "user_id,id",
    });
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  const keep = new Set(rows.map((r) => r.id));
  const toDelete = (existing || []).map((r) => r.id).filter((id) => !keep.has(id));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("brief_history")
      .delete()
      .eq("user_id", user.id)
      .in("id", toDelete);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
