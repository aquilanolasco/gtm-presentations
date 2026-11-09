"use client";

// One in-app dialog system for the whole workspace, so destructive actions, notices and
// text input never fall back to the browser's native confirm()/alert()/prompt() popups
// (which look like "the browser is asking", not our app). Anywhere in the tree:
//
//   const confirm = useConfirm();
//   if (await confirm({ title: "Delete this deck?", message: "This cannot be undone.", danger: true })) { ... }
//   const alert = useAlert();
//   await alert({ title: "Select some text first", message: "Pick the words, then Add link." });
//   const prompt = usePrompt();
//   const url = await prompt({ title: "Add link", message: "Link URL", placeholder: "https://..." });
//
// confirm -> boolean, alert -> void, prompt -> string | null. Enter accepts, Escape / backdrop cancels.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ConfirmOpts = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type AlertOpts = { title: string; message?: string; okLabel?: string; danger?: boolean };
type PromptOpts = { title: string; message?: string; placeholder?: string; defaultValue?: string; confirmLabel?: string; cancelLabel?: string; multiline?: boolean };

type Confirm = (o: ConfirmOpts) => Promise<boolean>;
type Alert = (o: AlertOpts) => Promise<void>;
type Prompt = (o: PromptOpts) => Promise<string | null>;

const Ctx = createContext<{ confirm: Confirm; alert: Alert; prompt: Prompt }>({
  confirm: async () => false, alert: async () => {}, prompt: async () => null,
});
export const useConfirm = () => useContext(Ctx).confirm;
export const useAlert = () => useContext(Ctx).alert;
export const usePrompt = () => useContext(Ctx).prompt;

const GRAD = "linear-gradient(135deg,#8b5cf6,#6366f1,#3b82f6)";

type State =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const confirm = useCallback<Confirm>((opts) => new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })), []);
  const alert = useCallback<Alert>((opts) => new Promise<void>((resolve) => setState({ kind: "alert", opts, resolve })), []);
  const prompt = useCallback<Prompt>((opts) => new Promise<string | null>((resolve) => { setText(opts.defaultValue ?? ""); setState({ kind: "prompt", opts, resolve }); }), []);

  const cancel = useCallback(() => setState((s) => {
    if (s?.kind === "confirm") s.resolve(false);
    else if (s?.kind === "alert") s.resolve();
    else if (s?.kind === "prompt") s.resolve(null);
    return null;
  }), []);
  const accept = useCallback(() => setState((s) => {
    if (s?.kind === "confirm") s.resolve(true);
    else if (s?.kind === "alert") s.resolve();
    else if (s?.kind === "prompt") s.resolve(text);
    return null;
  }), [text]);

  useEffect(() => {
    if (!state) return;
    if (state.kind === "prompt") { const t = setTimeout(() => inputRef.current?.focus(), 30); return () => clearTimeout(t); }
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      else if (e.key === "Enter" && !(state.kind === "prompt" && state.opts.multiline && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); accept(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, cancel, accept]);

  const o = state?.opts;
  const danger = !!(o && "danger" in o && o.danger);
  const isAlert = state?.kind === "alert";
  const isPrompt = state?.kind === "prompt";

  return (
    <Ctx.Provider value={{ confirm, alert, prompt }}>
      {children}
      {state && (
        <div onClick={cancel} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(22,13,46,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(2px)" }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
            style={{ width: 400, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 30px 80px rgba(22,13,46,.4)", overflow: "hidden", fontFamily: "inherit", animation: "ppConfirmIn .14s ease-out" }}>
            <style>{`@keyframes ppConfirmIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
            <div style={{ padding: "22px 22px 16px" }}>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: danger ? "rgba(220,38,38,.1)" : "rgba(99,102,241,.1)" }}>
                  {danger ? (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  ) : isPrompt ? (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  ) : (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
                  )}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16.5, fontWeight: 700, color: "#160d2e", lineHeight: 1.3, textWrap: "balance" } as React.CSSProperties}>{o?.title}</div>
                  {o?.message && <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#4b5563", margin: "7px 0 0" }}>{o.message}</p>}
                </div>
              </div>
              {isPrompt && (
                (state.opts.multiline
                  ? <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={state.opts.placeholder} rows={3}
                      style={{ width: "100%", boxSizing: "border-box", marginTop: 14, fontFamily: "inherit", fontSize: 13.5, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", color: "#160d2e", resize: "vertical", outline: "none" }} />
                  : <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={state.opts.placeholder}
                      style={{ width: "100%", boxSizing: "border-box", marginTop: 14, fontFamily: "inherit", fontSize: 13.5, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", color: "#160d2e", outline: "none" }} />)
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "0 22px 20px" }}>
              {!isAlert && (
                <button onClick={cancel} style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#4b5563", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  {(state.kind === "confirm" || state.kind === "prompt") ? (state.opts.cancelLabel || "Cancel") : "Cancel"}
                </button>
              )}
              <button autoFocus={!isPrompt} onClick={accept}
                style={{ border: "none", color: "#fff", borderRadius: 10, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", background: danger ? "#dc2626" : GRAD }}>
                {isAlert ? ((o as AlertOpts).okLabel || "OK")
                  : state.kind === "confirm" ? (state.opts.confirmLabel || (danger ? "Delete" : "Confirm"))
                  : (state.opts.confirmLabel || "Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
