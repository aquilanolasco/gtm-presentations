"use client";

// Skeleton placeholders. Real apps show the shape of the content while data loads,
// grey bars where text and cards will be, instead of a spinner or a "Loading..." line.
// Use <Skeleton/> for a single bar, <SkeletonCard/> for a card, and <SkeletonList/> for
// a stack. The shimmer is a single keyframe injected once.

import React from "react";

const SHIMMER_ID = "pp-skeleton-css";

function useShimmerCss() {
  if (typeof document !== "undefined" && !document.getElementById(SHIMMER_ID)) {
    const el = document.createElement("style");
    el.id = SHIMMER_ID;
    el.textContent = `
      @keyframes ppShimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
      .pp-skel { background: #eceaf3; background-image: linear-gradient(90deg,#eceaf3 0px,#f6f5fa 200px,#eceaf3 400px); background-size: 800px 100%; animation: ppShimmer 1.3s ease-in-out infinite; border-radius: 8px; }
      @media (prefers-reduced-motion: reduce) { .pp-skel { animation: none; } }
    `;
    document.head.appendChild(el);
  }
}

export function Skeleton({ width = "100%", height = 14, style }: { width?: number | string; height?: number | string; style?: React.CSSProperties }) {
  useShimmerCss();
  return <div className="pp-skel" style={{ width, height, ...style }} />;
}

export function SkeletonText({ lines = 3, width = "100%" }: { lines?: number; width?: number | string }) {
  useShimmerCss();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? "60%" : width} />
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  useShimmerCss();
  return (
    <div style={{ border: "1px solid #ece9f6", borderRadius: 14, background: "#fff", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Skeleton width={40} height={40} style={{ borderRadius: 11, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <Skeleton width="55%" height={13} />
          <div style={{ height: 6 }} />
          <Skeleton width="35%" height={10} />
        </div>
      </div>
      <SkeletonText lines={2} />
      {height > 120 && <div style={{ height: height - 120 }} />}
    </div>
  );
}

export function SkeletonGrid({ count = 6, min = 320 }: { count?: number; min?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${min}px,1fr))`, gap: 14 }}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

// Drop-in full-module loading state: a heading placeholder plus a card grid, so a page
// that is still fetching shows its shape instead of a bare "Loading..." line.
export function ModuleLoading({ cards = 6, min = 300 }: { cards?: number; min?: number }) {
  return (
    <div style={{ padding: "28px 32px", maxWidth: 1180, margin: "0 auto" }}>
      <Skeleton width={220} height={26} />
      <div style={{ height: 10 }} />
      <Skeleton width={360} height={13} />
      <div style={{ height: 26 }} />
      <SkeletonGrid count={cards} min={min} />
    </div>
  );
}
