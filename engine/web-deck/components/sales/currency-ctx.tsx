"use client";

/* Shared currency state for the sales decks. The top control sets it (or the Presentations
   viewer bar around the deck does, by postMessage); the live-screen iframes get it by
   postMessage (handled in CurrencyControl); the in-deck interactive showcase reads it here
   so its animated figures count up to the converted target with the right symbol.

   Every deck has a BASE currency, the one its figures are written in: the master Sales
   deck is AUD, the prospect sales decks (engage template) are USD. Amounts
   convert base -> USD -> target, so the rates table is USD-based and any base works. */

import { createContext, useContext, useState } from "react";

export type Cur = "USD" | "AUD" | "EUR" | "GBP";
export const CURRENCIES: Cur[] = ["USD", "AUD", "EUR", "GBP"];
// USD -> currency. Static, refreshed by hand (XE mid-market, late October 2026).
export const RATES: Record<Cur, number> = { USD: 1, AUD: 1.42, EUR: 0.9, GBP: 0.75 };
export const SYM: Record<Cur, string> = { USD: "$", AUD: "$", EUR: "€", GBP: "£" };
export const isCur = (x: unknown): x is Cur => typeof x === "string" && (CURRENCIES as string[]).includes(x);

/* One amount, base currency -> target. */
export const convAmt = (a: number, c: Cur, base: Cur) => (a / RATES[base]) * RATES[c];

const AMT = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;

/* Convert every "$N" in a string from the base currency to the target, preserving each
   figure's original decimal places (so "$18" stays whole, "$6.40" keeps two). */
export function convStr(t: string, c: Cur, base: Cur = "AUD"): string {
  if (!t || t.indexOf("$") < 0 || c === base) return t;
  return t.replace(AMT, (m, num: string) => {
    const a = parseFloat(num.replace(/,/g, ""));
    if (isNaN(a)) return m;
    const dot = num.indexOf(".");
    const dec = dot >= 0 ? num.length - dot - 1 : 0;
    return SYM[c] + convAmt(a, c, base).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  });
}

type CurCtx = { cur: Cur; setCur: (c: Cur) => void; base: Cur };
const Ctx = createContext<CurCtx>({ cur: "AUD", setCur: () => {}, base: "AUD" });
export const useCurrency = () => useContext(Ctx);

export function CurrencyProvider({ base = "AUD", children }: { base?: Cur; children: React.ReactNode }) {
  const [cur, setCur] = useState<Cur>(base);
  return <Ctx.Provider value={{ cur, setCur, base }}>{children}</Ctx.Provider>;
}
