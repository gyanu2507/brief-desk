"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  filterLocalSuggestions,
  type RepoSuggestion,
} from "../lib/repo-suggest";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  savedRepos?: string[];
  disabled?: boolean;
};

function formatStars(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k★`;
  return `${n}★`;
}

export function RepoCombobox({
  label,
  value,
  onChange,
  placeholder = "owner/name",
  savedRepos = [],
  disabled,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<RepoSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const savedItems = useMemo(
    () =>
      savedRepos
        .filter(Boolean)
        .map((repo) => ({ repo, description: "Saved session", source: "saved" as const })),
    [savedRepos],
  );

  const local = useMemo(
    () => filterLocalSuggestions(value, savedItems, 8),
    [value, savedItems],
  );

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: RepoSuggestion[] = [];
    for (const item of [...local, ...remote]) {
      const key = item.repo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 10) break;
    }
    return out;
  }, [local, remote]);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setRemote([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/repo-suggest?q=${encodeURIComponent(q)}`, {
            cache: "no-store",
          });
          const body = (await res.json()) as { suggestions?: RepoSuggestion[] };
          if (!cancelled) {
            setRemote(Array.isArray(body.suggestions) ? body.suggestions : []);
          }
        } catch {
          if (!cancelled) setRemote([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    setActive(0);
  }, [suggestions.length, value]);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (repo: string) => {
    onChange(repo);
    setOpen(false);
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(suggestions.length - 1, 0)));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (ev.key === "Enter" && suggestions[active]) {
      ev.preventDefault();
      pick(suggestions[active].repo);
    } else if (ev.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="repo-combobox" ref={rootRef}>
      <p className="section-label">{label}</p>
      <div className="repo-combobox-field">
        <input
          className="field"
          style={{ marginBottom: 0 }}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && suggestions[active] ? `${listId}-${active}` : undefined
          }
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {loading ? <span className="repo-combobox-busy">searching…</span> : null}
      </div>
      {open && suggestions.length > 0 ? (
        <ul id={listId} className="repo-combobox-list" role="listbox">
          {suggestions.map((item, i) => (
            <li
              key={`${item.source}-${item.repo}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`repo-combobox-option${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item.repo);
              }}
            >
              <span className="repo-combobox-name">{item.repo}</span>
              <span className="repo-combobox-meta">
                {formatStars(item.stars)}
                {item.source === "saved" ? " · saved" : item.source === "seed" ? "" : ""}
              </span>
              {item.description ? (
                <span className="repo-combobox-desc">{item.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open && value.trim().length >= 2 && !loading && suggestions.length === 0 ? (
        <div className="repo-combobox-empty">No matches. Keep typing owner/name.</div>
      ) : null}
    </div>
  );
}
