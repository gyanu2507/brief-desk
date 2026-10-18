import { NextResponse } from "next/server";
import {
  isSavedBrief,
  SAVED_MAX,
  type SavedBrief,
} from "../../../../lib/saved-shortcuts";
import { isSupabaseConfigured } from "../../../../lib/supabase/config";
import { createClient } from "../../../../lib/supabase/server";

function asSaved(row: { id: string; at: number; payload: unknown }): SavedBrief | null {
  const p = row.payload;
  if (!isSavedBrief(p)) return null;
  return { ...p, id: row.id, at: row.at };
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
    .from("saved_shortcuts")
    .select("id, at, payload")
    .eq("user_id", user.id)
    .order("at", { ascending: false })
    .limit(SAVED_MAX);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = (data || [])
    .map(asSaved)
    .filter((e): e is SavedBrief => Boolean(e));

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

  let body: { entries?: SavedBrief[] };
  try {
    body = (await request.json()) as { entries?: SavedBrief[] };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw = Array.isArray(body.entries) ? body.entries : [];
  const capped = raw.filter(isSavedBrief).slice(0, SAVED_MAX);

  const rows = capped.map((e) => ({
    user_id: user.id,
    id: e.id,
    at: typeof e.at === "number" ? e.at : Date.now(),
    payload: e,
  }));

  const { data: existing, error: listErr } = await supabase
    .from("saved_shortcuts")
    .select("id")
    .eq("user_id", user.id);
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase.from("saved_shortcuts").upsert(rows, {
      onConflict: "user_id,id",
    });
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  if (rows.length > 0) {
    const keep = new Set(rows.map((r) => r.id));
    const toDelete = (existing || []).map((r) => r.id).filter((id) => !keep.has(id));
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("saved_shortcuts")
        .delete()
        .eq("user_id", user.id)
        .in("id", toDelete);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
