import { createSignal } from "solid-js";
import {
  deleteSession, listSessions, loadSession, newSession, saveSession, type Session,
} from "@hextra/core/sessions.js";

/** Session store adapter: opencode's useSync session surface, backed by our JSON store. */
export function createSessionStore(model: string) {
  const [sessions, setSessions] = createSignal<{ id: string; title: string; updated: string }[]>([]);
  const [active, setActive] = createSignal<Session | null>(null);

  const refresh = () => setSessions(listSessions());
  const create = (bot?: string): Session => {
    const s = newSession(model, bot);
    saveSession(s);
    refresh();
    setActive(s);
    return s;
  };
  const resume = (id: string): Session | null => {
    const hit = listSessions().find((s) => s.id.startsWith(id)) ?? listSessions().find((s) => s.id === id);
    const loaded = hit ? loadSession(hit.id) : null;
    if (loaded) setActive(loaded);
    return loaded;
  };
  const remove = (id: string): boolean => {
    const ok = deleteSession(id);
    if (ok) {
      if (active()?.id === id) setActive(null);
      refresh();
    }
    return ok;
  };
  const persist = (s: Session): void => {
    saveSession(s);
    setActive({ ...s });
    refresh();
  };

  refresh();
  return { sessions, active, refresh, create, resume, remove, persist };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
