import React from "react";
import { Box, Text } from "ink";
import { renderDiff } from "@hextra/tools/diff.js";
import { redactSecrets } from "@hextra/core/secrets.js";
import { tokenizeMarkdown } from "./markdown.js";

export type TranscriptItem =
  | { kind: "msg"; who: "you" | "ai" | "sys"; text: string }
  | { kind: "tool"; id: number; callId: string; name: string; args: string; status: "running" | "done" | "denied"; ms?: number; result?: string };

export const SLASH_COMMANDS = ["/new", "/model", "/skills", "/usage", "/undo", "/compress", "/bot", "/setup", "/help", "/quit"];

function toolArgsSummary(name: string, args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>;
    const first = o.path ?? o.command ?? o.pattern ?? o.url ?? o.query ?? o.prompt ?? "";
    return String(first).slice(0, 80);
  } catch {
    return "";
  }
}

function DiffLines({ name, args }: { name: string; args: string }) {
  if (name !== "edit_file") return null;
  try {
    const o = JSON.parse(args) as { search?: string; replace?: string; path?: string };
    if (!o.search || o.replace === undefined) return null;
    return (
      <>
        {renderDiff(o.search, o.replace, 8).map((l, i) => (
          <Text key={i} color={l.startsWith("+") ? "green" : l.startsWith("-") ? "red" : "gray"}>{l}</Text>
        ))}
      </>
    );
  } catch {
    return null;
  }
}

export function ToolBlock({ item }: { item: Extract<TranscriptItem, { kind: "tool" }> }) {
  const color = item.status === "done" ? "green" : item.status === "denied" ? "red" : "yellow";
  const head = `${item.name} ${toolArgsSummary(item.name, item.args)}`.trim();
  const tail = item.status === "running" ? "…" : item.status === "denied" ? "denied" : `${item.ms}ms`;
  return (
    <Box borderStyle="single" borderColor={color} paddingX={1} flexDirection="column" marginY={0}>
      <Text color={color}>◈ {head} · {tail}</Text>
      <DiffLines name={item.name} args={item.args} />
      {item.status === "done" && item.result ? (
        <Text dimColor>{redactSecrets(item.result).split("\n").slice(0, 6).join("\n").slice(0, 600)}</Text>
      ) : null}
    </Box>
  );
}

export function ApprovalBox({ tool, args }: { tool: string; args: string }) {
  return (
    <Box borderStyle="double" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text bold color="yellow">Permission needed: {tool}</Text>
      <Text dimColor>{redactSecrets(args).slice(0, 200)}</Text>
      <DiffLines name={tool} args={args} />
      <Text>(a)llow once · al(w)ays · (d)eny [a]</Text>
    </Box>
  );
}

export function Markdown({ text }: { text: string }) {
  type Row = { t: "line"; parts: React.ReactNode[] } | { t: "block"; node: React.ReactNode };
  const rows: Row[] = [];
  let cur: React.ReactNode[] = [];
  let k = 0;
  const flush = () => {
    if (cur.length) {
      rows.push({ t: "line", parts: cur });
      cur = [];
    }
  };
  for (const t of tokenizeMarkdown(text)) {
    if (t.kind === "text") {
      for (const [i, s] of t.text.split("\n").entries()) {
        if (i > 0) flush();
        if (s) cur.push(<Text key={k++}>{s}</Text>);
      }
    } else if (t.kind === "bold") {
      cur.push(<Text key={k++} bold>{t.text}</Text>);
    } else if (t.kind === "code") {
      cur.push(<Text key={k++} color="cyan">{t.text}</Text>);
    } else {
      flush();
      if (t.kind === "codeblock") {
        rows.push({
          t: "block",
          node: (
            <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
              {t.lang ? <Text dimColor>{t.lang}</Text> : null}
              <Text>{t.text.split("\n").slice(0, 20).join("\n")}</Text>
            </Box>
          ),
        });
      } else {
        rows.push({
          t: "block",
          node: (
            <Box flexDirection="column" paddingLeft={2}>
              {t.items.map((it, j) => <Text key={j}>• {it}</Text>)}
            </Box>
          ),
        });
      }
    }
  }
  flush();
  return (
    <>
      {rows.map((r, i) => r.t === "line" ? <Text key={i}>{r.parts}</Text> : <React.Fragment key={i}>{r.node}</React.Fragment>)}
    </>
  );
}

export function SlashHints({ query }: { query: string }) {
  if (!query.startsWith("/")) return null;
  const hits = SLASH_COMMANDS.filter((c) => c.startsWith(query)).slice(0, 6);
  if (!hits.length) return null;
  return (
    <Box paddingX={2} flexDirection="column">
      {hits.map((c) => (
        <Text key={c} dimColor>{c}</Text>
      ))}
    </Box>
  );
}
