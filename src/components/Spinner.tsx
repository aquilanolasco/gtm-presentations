"use client";

// Small inline spinner used to show pending state on buttons and actions.
// Sits inline with text; inherits currentColor so it works on any button.

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.textContent = `@keyframes ppSpin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(el);
}

export function Spinner({ size = 14, stroke = 2, style }: { size?: number; stroke?: number; style?: React.CSSProperties }) {
  ensureKeyframes();
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `${stroke}px solid currentColor`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "ppSpin 0.6s linear infinite",
        opacity: 0.85,
        verticalAlign: "-2px",
        ...style,
      }}
    />
  );
}

export default Spinner;
