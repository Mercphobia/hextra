/** Minimal unified diff for single-block edits (edit_file previews). */
export function renderDiff(search: string, replace: string, maxLines = 12): string[] {
  const a = search.split("\n").slice(0, maxLines);
  const b = replace.split("\n").slice(0, maxLines);
  const out = [ ...a.map((l) => `- ${l}`), ...b.map((l) => `+ ${l}`) ];
  if (search.split("\n").length > maxLines || replace.split("\n").length > maxLines) {
    out.push(`… (truncated)`);
  }
  return out.map((l) => l.slice(0, 160));
}
