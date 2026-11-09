/* Scope a master deck's inline CSS to the slides lifted from it. Every selector is prefixed with
   `:where(<scope>) ` (zero specificity, so the cascade stays exactly the master's); a selector that
   starts at the deck root (`.pp[data-mode=...] ...`) keeps that root and takes the prefix after it,
   because the scope wrapper sits inside the deck, not around it. @media / @supports / @container
   blocks are recursed; @keyframes, @font-face and @property bodies are left as they are. */
export function scopeCss(css: string, scope: string): string {
  const prefix = `:where(${scope}) `;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const one = (sel: string): string => {
    const s = sel.trim();
    if (!s) return s;
    const root = s.match(/^(\.pp(?:\[[^\]]*\]|\.[\w-]+|:[\w-]+(?:\([^)]*\))?)*)\s+(.+)$/);
    if (root) return `${root[1]} ${prefix}${root[2]}`;
    if (/^(html|body|:root)\b/.test(s)) return s;
    return prefix + s;
  };
  const block = (src: string, raw: boolean): string => {
    let res = "", j = 0;
    while (j < src.length) {
      const open = src.indexOf("{", j);
      if (open < 0) { res += src.slice(j); break; }
      const head = src.slice(j, open).trim();
      let depth = 1, k = open + 1;
      while (k < src.length && depth) { if (src[k] === "{") depth++; else if (src[k] === "}") depth--; k++; }
      const body = src.slice(open + 1, k - 1);
      if (head.startsWith("@")) {
        const at = head.split(/[\s(]/)[0];
        if (/^@(media|supports|container|layer)$/.test(at)) res += `${head}{${block(body, raw)}}`;
        else res += `${head}{${body}}`;
      } else if (raw) res += `${head}{${body}}`;
      else res += `${head.split(",").map(one).filter(Boolean).join(",")}{${body}}`;
      j = k;
    }
    return res;
  };
  return block(clean, false);
}
