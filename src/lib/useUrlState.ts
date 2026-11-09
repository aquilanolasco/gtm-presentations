"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

// Isomorphic layout effect: restore state from the URL before the first paint on
// the client (no flash), fall back to a no-op effect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * A drop-in replacement for useState<string> that mirrors the value in the URL
 * query string (e.g. ?tab=slides). This makes the view survive a page refresh
 * and makes the browser Back / Forward buttons walk through previous views.
 *
 *   const [tab, setTab] = useUrlState("tab", "master");
 *
 * By default each change pushes a history entry (so Back returns to the previous
 * view). Pass { history: "replace" } for states where that would be noisy.
 * When the value equals the initial default the param is removed to keep URLs clean.
 */
export function useUrlState<T extends string>(
  key: string,
  initial: T,
  opts: { history?: "push" | "replace" } = {},
): [T, (v: T) => void] {
  const mode = opts.history ?? "push";
  const [value, setValue] = useState<T>(initial);

  const readFromUrl = useCallback((): T => {
    if (typeof window === "undefined") return initial;
    const v = new URLSearchParams(window.location.search).get(key);
    return (v as T) ?? initial;
  }, [key, initial]);

  // Restore from the URL before paint (keeps SSR/hydration output as `initial`,
  // then corrects to the URL value with no visible flash).
  useIsoLayoutEffect(() => {
    setValue(readFromUrl());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow browser Back / Forward.
  useEffect(() => {
    const onPop = () => setValue(readFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [readFromUrl]);

  const set = useCallback((v: T) => {
    setValue(v);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (v === initial) params.delete(key);
    else params.set(key, v);
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    const state = window.history.state;
    if (mode === "replace") window.history.replaceState(state, "", url);
    else window.history.pushState(state, "", url);
  }, [key, initial, mode]);

  return [value, set];
}
