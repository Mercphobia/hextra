export type MdToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "codeblock"; lang: string; text: string }
  | { kind: "list"; items: string[] };

/** Tiny markdown tokenizer: code blocks, bold, inline code, dash lists. */
export function tokenizeMarkdown(src: string): MdToken[] {
  const out: MdToken[] = [];
  const parts = src.split(/```/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const nl = parts[i].indexOf("\n");
      const lang = nl >= 0 ? parts[i].slice(0, nl).trim() : "";
      const text = nl >= 0 ? parts[i].slice(nl + 1) : parts[i];
      out.push({ kind: "codeblock", lang, text: text.replace(/\n$/, "") });
      continue;
    }
    const lines = parts[i].split("\n");
    let list: string[] = [];
    const flush = () => {
      if (list.length) {
        out.push({ kind: "list", items: list });
        list = [];
      }
    };
    for (const line of lines) {
      const m = line.match(/^\s*[-*]\s+(.*)$/);
      if (m) {
        list.push(m[1]);
        continue;
      }
      flush();
      out.push(...inline(line));
      out.push({ kind: "text", text: "\n" });
    }
    flush();
  }
  return out.filter((t) => !(t.kind === "text" && t.text === ""));
}

function inline(s: string): MdToken[] {
  const out: MdToken[] = [];
  const re = /(\*\*.+?\*\*|`[^`]+?`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ kind: "text", text: s.slice(last, m.index) });
    const tok = m[1];
    if (tok.startsWith("**")) out.push({ kind: "bold", text: tok.slice(2, -2) });
    else out.push({ kind: "code", text: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}
