/** Fixed option lists for control-panel dropdowns. */

export const TRENDING_LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "Any language" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "java", label: "Java" },
  { value: "c++", label: "C++" },
  { value: "c#", label: "C#" },
  { value: "c", label: "C" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "dart", label: "Dart" },
  { value: "scala", label: "Scala" },
  { value: "shell", label: "Shell" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
  { value: "astro", label: "Astro" },
  { value: "jupyter-notebook", label: "Jupyter Notebook" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "powershell", label: "PowerShell" },
  { value: "lua", label: "Lua" },
  { value: "elixir", label: "Elixir" },
  { value: "haskell", label: "Haskell" },
  { value: "r", label: "R" },
  { value: "zig", label: "Zig" },
];

export const TRENDING_SINCE: { value: "daily" | "weekly" | "monthly"; label: string }[] = [
  { value: "daily", label: "Today" },
  { value: "weekly", label: "This week" },
  { value: "monthly", label: "This month" },
];

export const THEME_OPTIONS: { value: "light" | "dark" | "system"; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function isKnownLanguage(value: string): boolean {
  return TRENDING_LANGUAGES.some((o) => o.value === value);
}
