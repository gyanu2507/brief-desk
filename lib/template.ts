/** Simple {{var}} fill. Lines that still contain {{…}} after fill are dropped. */
export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value ?? "");
  }
  return out
    .split("\n")
    .filter((line) => !/\{\{[a-zA-Z0-9_]+\}\}/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
