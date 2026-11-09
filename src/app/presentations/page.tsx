"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import AppShell from "@/components/AppShell";
import { trpc } from "@/lib/trpc/client";
import { BUILD_STAMP } from "@/lib/build-stamp";

// Compact deck-card icons. The file buttons use the real PowerPoint and Adobe PDF logos so they read
// instantly as the file type the download produces.
const IcoPlay = () => (<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>);
const IcoEdit = () => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
const IcoShare = () => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" /></svg>);
const IcoTrash = () => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>);
const IcoArchive = () => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>);
const IcoRestore = () => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7v6h6" /><path d="M3.5 13a9 9 0 1 0 2.1-9.4L3 7" /></svg>);
const IcoPpt = () => (<img src="/deck-icons/powerpoint.webp" alt="PowerPoint" width={19} height={19} style={{ display: "block", objectFit: "contain" }} />);
const IcoPdf = () => (<img src="/deck-icons/pdf.webp" alt="PDF" width={17} height={17} style={{ display: "block", objectFit: "contain" }} />);
import { useConfirm } from "@/components/ConfirmProvider";
import { Spinner } from "@/components/Spinner";
import { SkeletonGrid } from "@/components/Skeleton";
import { useUrlState } from "@/lib/useUrlState";
import CreatePane from "./CreatePane";
import SlidesTab, { CATS, type SlideViewer } from "./SlidesTab";
import Builder from "./Builder";
import SlideEditor from "./SlideEditor";

type Template = {
  title: string;
  meta: string;
  img: string | null;
  badge: string;
  preview?: string; // what loads in the right pane when selected
  open?: string; // where "Open" launches full-screen
  ready: boolean;
  featured?: boolean;
  adminOnly?: boolean; // only the super admin can see / open this
  notReady?: boolean;  // parked: shown greyed with a red flag so it is not confused for live work
  archived?: boolean;  // hidden from EVERYONE (incl. super admin) in the normal view; still in code for
                       // backend retrieval, and a super admin can reveal them in-app with ?archived=1
  slug?: string;       // deck folder slug; used to build export/download URLs
  kind?: "master" | "user"; // Master Presentations tab vs Your Presentations tab
  category?: "sales"; // "sales" decks live in the Sales Decks tab, not Master Decks
  updated?: string; // last build/update date shown on the compact card (YYYY-MM-DD)
  canva?: string; // Canva team design URL (import of the PPTX)
};

// A deck's downloadable exports (built by the export pipeline, served with a download header).
// The ?v= token busts Cloudflare's cache so a freshly rebuilt export is never served stale.
const EXPORT_V = BUILD_STAMP.replace(/\D/g, "");

// The closing (last) page of every export carries a presenter's CTA signature. The download
// dropdown picks whose signature appears; "" = the deck's own default presenter (base file).
// Sample roster (original presenter list removed). Each key matches a `--<key>` export variant.
const SIG_PEOPLE: { key: string; label: string }[] = [
  { key: "", label: "Deck default" },
  { key: "jane", label: "Jane Doe" },
  { key: "john", label: "John Smith" },
  { key: "alex", label: "Alex Lee" },
  { key: "sam", label: "Sam Taylor" },
];

// Super-admin gate, same rule as the documents master-template lock: a company-domain address
// whose local part matches the super admin's name (with or without a separator).
function isSuperAdmin(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  const domainOk = e.endsWith("@example.com");
  return domainOk && /jane[._-]?doe/.test(e);
}

// A deck served at /presentations/<slug>/ used to answer with permanent redirects (Next's
// 308 slash-strip, then nginx's 301 slash-add). Browsers that cached BOTH resolve them into
// an infinite loop entirely from cache and never re-hit the now-fixed server, so the preview
// shows "redirected too many times". Appending a version query gives a URL with no cached
// redirect, so it reaches the server cleanly. Bump v when a deck path ever loops again.
function fresh(u?: string): string | undefined {
  if (!u) return u;
  if (!u.startsWith("/presentations/")) return u;
  return u + (u.includes("?") ? "&" : "?") + "v=5";
}

// Sample deck list (original deck names, clients and Canva design links removed).
const TEMPLATES: Template[] = [
  {
    title: "Example Hotels Sales Deck",
    meta: "11 slides · Example Hotels partnership intro",
    img: null,
    badge: "Live",
    preview: "/p/acme-example-hotels-sales-deck/deck/",
    slug: "acme-example-hotels-sales-deck",
    updated: "2026-10-20",
    kind: "master",
    category: "sales",
    open: "/p/acme-example-hotels-sales-deck/deck/",
    ready: true,
    featured: true,
  },
  {
    title: "Sample Resort Group Sales Deck",
    meta: "11 slides · Prospect strategy intro + Short Pack",
    img: null,
    badge: "Live",
    preview: "/p/acme-sample-resort-sales-deck/deck/",
    slug: "acme-sample-resort-sales-deck",
    updated: "2026-10-20",
    kind: "master",
    category: "sales",
    open: "/p/acme-sample-resort-sales-deck/deck/",
    ready: true,
  },
  {
    title: "Town Hall Master Template",
    meta: "17 layouts · Town hall (in build)",
    img: "/p/u-thmaster/thumb.png",
    badge: "Template",
    preview: "/p/u-thmaster/",
    slug: "u-thmaster",
    kind: "master",
    open: "/p/u-thmaster/",
    ready: true,
    archived: true, // archived: hidden from the module; retrievable in the backend
  },
  {
    title: "Acme Introduction Deck",
    meta: "31 slides · Company overview",
    img: "/img/intro-cover.png",
    badge: "Live",
    preview: "/p/acme-introduction-deck/deck/",
    slug: "acme-introduction-deck",
    updated: "2026-08-28",
    canva: "https://www.canva.com/design/<CANVA_DESIGN_ID>/view",
    kind: "master",
    open: "/p/acme-introduction-deck/deck/",
    ready: true,
    featured: true,
  },
  {
    title: "Acme Sales Deck",
    meta: "19 slides · The application, module by module",
    img: "/img/sales-cover.png",
    badge: "Live",
    preview: "/p/acme-sales-deck/deck/",
    slug: "acme-sales-deck",
    updated: "2026-10-14",
    canva: "https://www.canva.com/design/<CANVA_DESIGN_ID>/view",
    kind: "master",
    open: "/p/acme-sales-deck/deck/",
    ready: true,
  },
  {
    title: "Acme Short Pack",
    meta: "7 slides · High level, for senior stakeholders",
    img: "/img/shortpack-cover.png",
    badge: "Live",
    preview: "/p/acme-short-pack/deck/",
    slug: "acme-short-pack",
    updated: "2026-08-28",
    canva: "https://www.canva.com/design/<CANVA_DESIGN_ID>/view",
    kind: "master",
    open: "/p/acme-short-pack/deck/",
    ready: true,
  },
  {
    title: "Healthcare Introduction Deck",
    meta: "12 slides · Company overview for healthcare",
    img: "/img/intro-healthcare-cover.png",
    badge: "Live",
    preview: "/p/acme-healthcare-intro/deck/",
    slug: "acme-healthcare-intro",
    updated: "2026-09-27",
    kind: "master",
    open: "/p/acme-healthcare-intro/deck/",
    ready: true,
  },
  {
    title: "Aged Care, Senior Villages Introduction Deck",
    meta: "12 slides · Company overview for aged care and senior living",
    img: "/img/intro-agedcare-cover.png",
    badge: "Live",
    preview: "/p/acme-aged-care-intro/deck/",
    slug: "acme-aged-care-intro",
    updated: "2026-09-27",
    kind: "master",
    open: "/p/acme-aged-care-intro/deck/",
    ready: true,
  },
  {
    title: "Healthcare Sales Deck",
    meta: "19 slides · The application, module by module, for healthcare",
    img: "/img/sales-healthcare-cover.png",
    badge: "Live",
    preview: "/p/acme-healthcare-sales/deck/",
    slug: "acme-healthcare-sales",
    updated: "2026-10-14",
    kind: "master",
    open: "/p/acme-healthcare-sales/deck/",
    ready: true,
  },
  {
    title: "Aged Care, Senior Villages Sales Deck",
    meta: "19 slides · The application, module by module, for aged care",
    img: "/img/sales-agedcare-cover.png",
    badge: "Live",
    preview: "/p/acme-aged-care-sales/deck/",
    slug: "acme-aged-care-sales",
    updated: "2026-10-14",
    kind: "master",
    open: "/p/acme-aged-care-sales/deck/",
    ready: true,
  },
  {
    title: "Acme Proposal Deck",
    meta: "13 slides · Proposal template",
    img: "/img/proposal-cover.jpg",
    badge: "Live",
    preview: "/presentations/acme-proposal-deck/",
    slug: "acme-proposal-deck",
    kind: "master",
    open: "/presentations/acme-proposal-deck/",
    ready: true,
    archived: true,
  },
  {
    title: "Master Template",
    meta: "11 slide types · Brand system",
    img: "/img/master-cover.jpg",
    badge: "Template",
    preview: "/presentation-agent/template/master-template.html",
    kind: "master",
    open: "/presentation-agent/template/master-template.html",
    ready: true,
    archived: true,
  },
];

const CREATE = "create";

export default function PresentationsPage() {
  const { data: session } = useSession();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  // Default view: the first ready presentation is selected and shown on the right.
  const [view, setView] = useState<number | typeof CREATE>(0);
  // Master Presentations (the approved decks) vs Your Presentations (user-created).
  // URL-backed so a refresh keeps the tab and Back returns to the previous one.
  const [tab, setTab] = useUrlState<"master" | "sales" | "mine" | "shared" | "slides" | "person" | "archived">("tab", "master");
  // super-admin "By person" view: which creator's decks to show (email). null = not a person view.
  const [personEmail, setPersonEmail] = useState<string | null>(null);
  // Slides tab: the template open in the fullscreen viewer, lifted here so the left-panel list can open it too.
  const [slideViewer, setSlideViewer] = useState<SlideViewer>(null);
  // Public "Share" link modal: the slug whose link we're showing (null = closed).
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  // chosen signature presenter for export downloads ("" = each deck's default)
  const [sigKey, setSigKey] = useState<string>("");
  const sigSuffix = sigKey ? `--${sigKey}` : "";
  const dlPptx = (slug?: string) => (slug ? `/presentation-exports/${slug}/${slug}${sigSuffix}.pptx?v=${EXPORT_V}` : undefined);
  const dlPdf = (slug?: string) => (slug ? `/presentation-exports/${slug}/${slug}${sigSuffix}.pdf?v=${EXPORT_V}` : undefined);
  const [copied, setCopied] = useState(false);
  const shareUrl = shareSlug ? `https://${process.env.NEXT_PUBLIC_APP_DOMAIN ?? "app.example.com"}/public/presentations/${shareSlug}` : "";

  // Company sharing (user decks only): the deck being shared + its current sharing state.
  type Role = "view" | "edit";
  type ShareDeck = { id: string; slug: string; companyShared: boolean; companyRole: Role; sharedEmails: { email: string; role: Role }[] };
  const [shareDeck, setShareDeck] = useState<ShareDeck | null>(null);
  const colleagues = trpc.presentations.people.useQuery(undefined, { enabled: !!shareDeck });

  // User-created decks (Your Presentations). Poll while any is still generating.
  const mine = trpc.presentations.listMine.useQuery(undefined, {
    refetchInterval: (q) => {
      const data = q.state.data as { status: string }[] | undefined;
      return Array.isArray(data) && data.some((d) => d.status === "generating" || d.status === "processing") ? 4000 : false;
    },
  });
  const shared = trpc.presentations.listShared.useQuery();
  // every teammate's sales decks (Sales Decks tab). Poll while one is still building.
  const sales = trpc.presentations.listSales.useQuery(undefined, {
    refetchInterval: (q) => {
      const data = q.state.data as { status: string }[] | undefined;
      return Array.isArray(data) && data.some((d) => d.status === "generating" || d.status === "processing") ? 4000 : false;
    },
  });
  // super-admin only: every user-created deck, for the "By person" breakdown. Enabled lazily.
  const all = trpc.presentations.listAll.useQuery(undefined, { enabled: isSuperAdmin(session?.user?.email) });
  // archived (recover) decks — super admin sees all, a normal user sees their own. Loaded lazily.
  const archivedQ = trpc.presentations.listArchived.useQuery(undefined, { enabled: tab === "archived" });
  // refresh every deck list after an archive / restore / delete / rename so all views stay in sync
  const refetchDecks = () => { mine.refetch(); shared.refetch(); sales.refetch(); if (all.data !== undefined || isSuperAdmin(session?.user?.email)) all.refetch(); archivedQ.refetch(); };
  const removeDeck = trpc.presentations.remove.useMutation({ onSuccess: refetchDecks });
  const archiveDeck = trpc.presentations.setArchived.useMutation({ onSuccess: refetchDecks });
  const renameDeck = trpc.presentations.rename.useMutation({ onSuccess: refetchDecks });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const commitRename = (id: string) => { const t = renameVal.trim(); setRenaming(null); if (t) renameDeck.mutate({ id, title: t }); };
  const setSharing = trpc.presentations.setSharing.useMutation({ onSuccess: () => { mine.refetch(); setShareDeck(null); } });
  // when a user deck (My Decks / Shared) is clicked, preview THAT deck in the right pane
  const [userPreview, setUserPreview] = useState<{ slug: string; title: string; at?: number } | null>(null);
  const [liveSlide, setLiveSlide] = useState(0);
  const [builder, setBuilder] = useState<{ id: string; slug: string; title: string } | null>(null);
  // on-canvas Slide Editor (Canva-style) for a user's own deck, or (admins only) a master deck
  // generated sales decks open in "sales" mode (words, text size, photos, hide / add slides; the design
  // stays locked), master decks in "full" mode (move, resize, colours, fonts)
  const [editor, setEditor] = useState<{ id: string; slug: string; title: string; edits?: Record<string, unknown>; mode?: "sales" | "full" } | null>(null);
  // admins (and the super admin) may text-edit master decks; edits save as a versioned patch layer
  const myProfile = trpc.admin.myProfile.useQuery();
  const canEditMaster = (myProfile.data?.role ?? "") === "super_admin"; // master decks are edited by the super admin only; everyone edits their own sales decks
  // open the on-canvas editor on a master deck, seeded with its current saved edits (if any)
  const openMasterEditor = async (slug: string, title: string) => {
    let edits: Record<string, unknown> = {};
    try { const r = await fetch(`/p/${slug}/deck/edits.json?t=${Date.now()}`); if (r.ok) edits = await r.json(); } catch { /* no edits yet */ }
    setEditor({ id: "master:" + slug, slug, title, edits });
  };
  // capture ?edit=<slug> at first render (before the URL-sync effect strips it) so the viewer's Edit button works
  const [pendingEdit] = useState<string | null>(() => { try { return new URLSearchParams(window.location.search).get("edit"); } catch { return null; } });
  // resizable + collapsible presentations panel (persist per browser). Drag the right edge to resize;
  // drag it nearly shut (or press the collapse button) to fold it to the side so the presenter gets full width.
  const [libWidth, setLibWidth] = useState(380);
  const [libCollapsed, setLibCollapsed] = useState(false);
  const hubRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const widthRef = useRef(380);
  useEffect(() => {
    try {
      const w = parseInt(localStorage.getItem("pp_prez_libw") || "", 10);
      if (w >= 240 && w <= 720) { setLibWidth(w); widthRef.current = w; }
      if (localStorage.getItem("pp_prez_libcollapsed") === "1") setLibCollapsed(true);
    } catch {}
  }, []);
  const collapseLib = (c: boolean) => { setLibCollapsed(c); try { localStorage.setItem("pp_prez_libcollapsed", c ? "1" : "0"); } catch {} };
  const startResize = (e: React.MouseEvent) => { e.preventDefault(); draggingRef.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!draggingRef.current || !hubRef.current) return;
      const w = e.clientX - hubRef.current.getBoundingClientRect().left;
      if (w < 170) { draggingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; collapseLib(true); return; }
      const clamped = Math.min(720, Math.max(240, w));
      widthRef.current = clamped; setLibWidth(clamped);
    };
    const up = () => { if (!draggingRef.current) return; draggingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; try { localStorage.setItem("pp_prez_libw", String(widthRef.current)); } catch {} };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // keep the right pane correct per tab: master decks preview master templates; My Decks / Shared
  // preview a user deck (default to the first ready one), never a master.
  useEffect(() => {
    if (tab === "master" || tab === "slides" || tab === "archived") { if (userPreview) setUserPreview(null); return; }
    if (tab === "sales") {
      // keep the preview only when it's one of my sales decks; a master sales template shows via `view`.
      const salesDeck = userPreview && (sales.data ?? []).some((d: { slug: string }) => d.slug === userPreview.slug);
      if (userPreview && !salesDeck) setUserPreview(null);
      return;
    }
    if (userPreview) return;
    const list = tab === "mine"
      ? (mine.data ?? []).filter((d: { status: string }) => d.status === "ready")
      : tab === "person"
      ? (all.data ?? []).filter((d: { ownerEmail: string; status: string }) => d.ownerEmail === personEmail && d.status === "ready")
      : (shared.data ?? []);
    const first = list[0] as { slug: string; title: string } | undefined;
    if (first) setUserPreview({ slug: first.slug, title: first.title });
  }, [tab, mine.data, shared.data, sales.data, all.data, personEmail, userPreview]);

  // Restore the tab + open user deck from the URL on load, then keep the URL in sync. The Master Decks
  // selection is intentionally NOT restored: a refresh always starts on the deck at the top of the list.
  const restored = useRef(false);
  const deepLinked = useRef(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab"); const hasTab = !!(t && ["master", "sales", "mine", "shared", "slides"].includes(t));
    if (hasTab) setTab(t as typeof tab);
    // Internal link 1 — the module deep-linked to a deck: /presentations/<slug>. (Presentation mode
    // /presentations/p/<slug> is served by nginx as the fullscreen viewer and never reaches Next.)
    const pm = window.location.pathname.match(/^\/presentations\/([^/?#]+)\/?$/);
    const pathDeck = pm ? decodeURIComponent(pm[1]) : null;
    if (pathDeck) {
      deepLinked.current = true;
      const idx = TEMPLATES.findIndex((x) => x.slug === pathDeck);
      if (idx >= 0) { if (!hasTab) setTab(TEMPLATES[idx].category === "sales" ? "sales" : "master"); setView(idx); }
      else { setUserPreview({ slug: pathDeck, title: pathDeck }); if (!hasTab) setTab("mine"); }
    } else {
      const dk = p.get("deck"); const s = p.get("s");
      if (dk) setUserPreview({ slug: dk, title: dk, at: s && /^\d+$/.test(s) ? +s : undefined });
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    const slug = userPreview?.slug ?? (typeof view === "number" ? TEMPLATES[view]?.slug : undefined);
    if (view !== CREATE && slug) window.history.replaceState(null, "", `/presentations/${slug}`);
    else window.history.replaceState(null, "", `/presentations?tab=${tab}`);
  }, [tab, view, userPreview]);
  // a /presentations/<slug> deep link to a SALES deck lands on the Sales Decks tab once the list is in
  const deepTabFixed = useRef(false);
  useEffect(() => {
    if (deepTabFixed.current || !deepLinked.current || !userPreview || !sales.data) return;
    deepTabFixed.current = true;
    if ((sales.data as { slug: string }[]).some((d) => d.slug === userPreview.slug) && tab === "mine") setTab("sales");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales.data, userPreview]);
  // the open deck reports its current slide (postMessage from the deck viewer); track it for the URL,
  // and reset when the open deck changes.
  useEffect(() => { setLiveSlide(userPreview?.at ?? 0); }, [userPreview?.slug]);
  useEffect(() => {
    const on = (e: MessageEvent) => { const d = e.data as { ppSlide?: number }; if (d && typeof d.ppSlide === "number") setLiveSlide(d.ppSlide); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  // "View as" (AppShell) stores the impersonated email under pp_impersonate. When the
  // super admin is previewing as someone else, the hub must show exactly what that person
  // would see, so the admin gate uses the impersonated email, not the real session.
  const [impEmail, setImpEmail] = useState<string | null>(null);
  useEffect(() => {
    const read = () => { try { setImpEmail(localStorage.getItem("pp_impersonate")); } catch {} };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  useEffect(() => {
    if (!session?.user?.email) return;
    const user = {
      email: session.user.email,
      name: session.user.name ?? session.user.email.split("@")[0],
      picture: session.user.image ?? null,
    };
    try {
      localStorage.setItem("pp_agent_user", JSON.stringify({ user, savedAt: Date.now() }));
    } catch {}
  }, [session]);

  // Admin-only entries (the Master Template) and anything still parked as not ready are
  // hidden from everyone except the super admin, so the hub only ever shows work that is
  // finished and safe to present. While previewing as another user, the impersonated email
  // decides access, so a non-admin preview (e.g. a regular user) never sees the parked decks.
  const canSeeAdmin = !impEmail && isSuperAdmin(session?.user?.email);
  // archived decks are hidden from EVERYONE by default; a super admin can reveal them in-app with ?archived=1
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => { try { setShowArchived(new URLSearchParams(location.search).get("archived") === "1"); } catch {} }, []);
  const revealArchived = canSeeAdmin && showArchived;
  // user-defined list order (drag a card up/down to reorder; persisted per browser)
  const [deckOrder, setDeckOrder] = useState<string[]>([]);
  useEffect(() => { try { const o = JSON.parse(localStorage.getItem("pp_prez_order") || "[]"); if (Array.isArray(o)) setDeckOrder(o as string[]); } catch {} }, []);
  const dragTitle = useRef<string | null>(null);
  const visible = useMemo(() => {
    const base = TEMPLATES.map((t, i) => ({ t, i }))
      .filter(({ t }) => (!t.archived || revealArchived))
      .filter(({ t }) => canSeeAdmin || (!t.adminOnly && !t.notReady));
    if (!deckOrder.length) return base;
    const pos = new Map(deckOrder.map((title, n) => [title, n]));
    return [...base].sort((a, b) => (pos.get(a.t.title) ?? 999) - (pos.get(b.t.title) ?? 999));
  }, [canSeeAdmin, deckOrder, revealArchived]);
  // drop a dragged card onto another to move it there; the new order persists
  const dropCard = (target: string) => {
    const from = dragTitle.current; dragTitle.current = null;
    if (!from || from === target) return;
    const cur = visible.map((x) => x.t.title);
    const a = cur.indexOf(from), b = cur.indexOf(target);
    if (a < 0 || b < 0) return;
    cur.splice(b, 0, ...cur.splice(a, 1));
    setDeckOrder(cur);
    try { localStorage.setItem("pp_prez_order", JSON.stringify(cur)); } catch {}
  };
  // Master Decks tab shows the approved templates; My Decks + Shared render from the DB queries.
  const shown = useMemo(
    () => visible.filter(({ t }) => t.kind !== "user" && t.category !== "sales").filter(({ t }) => t.title.toLowerCase().includes(q.trim().toLowerCase())),
    [q, visible],
  );
  // Sales Decks tab: client/prospect engagement decks (category "sales"), same card UI as master.
  const salesShown = useMemo(
    () => visible.filter(({ t }) => t.kind !== "user" && t.category === "sales").filter(({ t }) => t.title.toLowerCase().includes(q.trim().toLowerCase())),
    [q, visible],
  );
  // If the selected card isn't one this viewer can see, fall back to the first they can.
  useEffect(() => {
    if (view === CREATE) return;
    if (!visible.some(({ i }) => i === view)) setView(visible[0]?.i ?? CREATE);
  }, [visible, view]);
  // On the Sales tab, keep the right-pane preview on a sales deck (not a leftover master).
  useEffect(() => {
    if (tab !== "sales" || view === CREATE) return; // don't yank the user out of the Create pane
    const cur = typeof view === "number" ? TEMPLATES[view] : undefined;
    if (!cur || cur.category !== "sales") setView(salesShown[0]?.i ?? CREATE);
  }, [tab, salesShown, view]);
  // On load, start on the deck at the top of the list (whatever the saved order puts first).
  const initialPicked = useRef(false);
  useEffect(() => {
    if (initialPicked.current || !restored.current || !visible.length) return;
    initialPicked.current = true;
    if (deepLinked.current) return; // a /presentations/<slug> deep link already chose the deck
    if (!userPreview) setView(visible[0].i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Deep link ?edit=<slug> (from the deck viewer's Edit button) opens the Slide Editor for that deck.
  const openedEdit = useRef(false);
  useEffect(() => {
    if (openedEdit.current || !pendingEdit) return;
    const list = mine.data as { id: string; slug: string; title: string; engine?: string; edits?: unknown }[] | undefined;
    if (!list) return; // wait for the user's decks to load, then match
    openedEdit.current = true;
    const d = list.find((x) => x.slug === pendingEdit);
    if (d && d.engine !== "gamma") { setTab("mine"); setEditor({ id: d.id, slug: d.slug, title: d.title, edits: (d.edits as Record<string, unknown>) || {}, mode: d.engine === "engage" ? "sales" : "full" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.data]);

  // ...and can't be opened in the right pane either, even if the index is reached some other way.
  const selected = typeof view === "number" ? TEMPLATES[view] : undefined;
  const blocked = !!(selected?.adminOnly || selected?.notReady) && !canSeeAdmin;
  const rightSrc = view === CREATE ? "/presentation-agent/intake.html" : blocked ? undefined : fresh(selected?.preview);
  const rightTitle = view === CREATE ? "Create a presentation" : blocked ? "" : selected?.title;

  // A user-created deck card, reused by My Decks (general) and the Sales Decks tab (kind === "sales").
  type UserDeck = { id: string; title: string; slug: string; status: string; statusMsg?: string | null; canvaUrl?: string | null; slideCount?: string | null; companyShared?: boolean; companyRole?: string; sharedEmails?: unknown; engine?: string; gammaUrl?: string | null; edits?: unknown; kind?: string };
  const myEmail = (session?.user?.email || "").toLowerCase();
  const renderUserDeck = (d: UserDeck, arch = false) => {
    // someone else's sales deck: present / download / share only (the owner and super admins edit or archive)
    const ownerEmail = ((d as UserDeck & { ownerEmail?: string }).ownerEmail || "").toLowerCase();
    const readOnly = !!ownerEmail && ownerEmail !== myEmail && !canSeeAdmin;
    const busy = d.status === "generating" || d.status === "processing";
    const failed = d.status === "failed";
    const ready = !busy && !failed;
    const isGamma = d.engine === "gamma";
    const presentHref = isGamma && d.gammaUrl ? d.gammaUrl : `/presentations/p/${d.slug}/`;
    const stop = (e: React.MouseEvent) => e.stopPropagation();
    const ownerName = (d as UserDeck & { ownerName?: string }).ownerName;
    return (
      <div
        className={`prez-card${ready || arch ? "" : " disabled"}${userPreview?.slug === d.slug ? " selected" : ""}`}
        key={d.id}
        onClick={ready && !arch ? () => { setUserPreview({ slug: d.slug, title: d.title }); } : undefined}
        role={ready && !arch ? "button" : undefined}
        tabIndex={ready && !arch ? 0 : undefined}
      >
        <div className="prez-cbody compact">
          {!ready && <span className={`prez-badge${busy ? " soon" : " notready"}`}>{busy ? "Generating" : "Failed"}</span>}
          {renaming === d.id ? (
            <input className="prez-rename" autoFocus value={renameVal}
              onClick={stop} onDoubleClick={stop}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRename(d.id); } else if (e.key === "Escape") { setRenaming(null); } }}
              onBlur={() => commitRename(d.id)} />
          ) : (
            <div className="prez-ctitle" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setRenameVal(d.title); setRenaming(d.id); }}>{d.title}</div>
          )}
          <div className="prez-cmeta">{(arch || readOnly) && ownerName ? `${ownerName} · ` : ""}{busy ? (d.statusMsg || "Generating…") : failed ? (d.statusMsg || "Generation failed") : `${d.slideCount || ""} slides`}</div>
          {arch ? (
            <div className="prez-icrow" onClick={stop}>
              {ready && <a className="prez-ic" href={presentHref} target="_blank" rel="noopener noreferrer" title="Preview"><IcoPlay /></a>}
              <button className="prez-ic" title="Restore" disabled={archiveDeck.isPending} onClick={() => archiveDeck.mutate({ id: d.id, archived: false })}>{archiveDeck.isPending ? <Spinner /> : <IcoRestore />}</button>
              <button className="prez-ic danger" title="Delete permanently" disabled={removeDeck.isPending} onClick={async () => { if (await confirm({ title: "Delete permanently?", message: "This cannot be undone. The deck and its files are removed for good.", danger: true })) removeDeck.mutate({ id: d.id }); }}>{removeDeck.isPending ? <Spinner /> : <IcoTrash />}</button>
            </div>
          ) : ready && (
            <div className="prez-icrow" onClick={stop}>
              <a className="prez-ic primary" href={presentHref} target="_blank" rel="noopener noreferrer" title="Present"><IcoPlay /></a>
              {readOnly ? null : isGamma ? (
                <a className="prez-ic" href={d.gammaUrl || presentHref} target="_blank" rel="noopener noreferrer" title="Open on Gamma"><IcoEdit /></a>
              ) : (
                <button className="prez-ic" title={d.engine === "engage" ? "Edit: words, text size, photos, hide or add slides" : "Edit"} onClick={() => setEditor({ id: d.id, slug: d.slug, title: d.title, edits: (d.edits as Record<string, unknown>) || {}, mode: d.engine === "engage" ? "sales" : "full" })}><IcoEdit /></button>
              )}
              <a className="prez-ic" href={dlPptx(d.slug)} download title="Download PowerPoint"><IcoPpt /></a>
              {!isGamma && <a className="prez-ic" href={dlPdf(d.slug)} download title="Download PDF"><IcoPdf /></a>}
              <button className="prez-ic" title="Share" onClick={() => { setCopied(false); setShareSlug(d.slug); if (!readOnly) setShareDeck({ id: d.id, slug: d.slug, companyShared: !!d.companyShared, companyRole: (d.companyRole === "edit" ? "edit" : "view"), sharedEmails: Array.isArray(d.sharedEmails) ? (d.sharedEmails as { email: string; role: Role }[]) : [] }); }}><IcoShare /></button>
              {!readOnly && <button className="prez-ic" title="Archive" disabled={archiveDeck.isPending} onClick={async () => { if (await confirm({ title: "Archive this presentation?", message: "It leaves your list but can be restored from Archived at any time.", danger: false })) archiveDeck.mutate({ id: d.id, archived: true }); }}>{archiveDeck.isPending ? <Spinner /> : <IcoArchive />}</button>}
            </div>
          )}
          {busy && <div className="prez-icrow"><span className="prez-ic" style={{ opacity: .6, flex: 1, cursor: "default" }}>Working…</span></div>}
        </div>
      </div>
    );
  };
  const myDecks = (mine.data ?? []) as UserDeck[];
  const generalDecks = myDecks.filter((d) => (d.kind ?? "general") !== "sales");
  const userSalesDecks = ((sales.data ?? []) as (UserDeck & { ownerEmail: string; ownerName?: string })[]);
  // super-admin "By person" breakdown: distinct creators (with names), and the selected person's decks.
  const allDecks = ((all.data ?? []) as (UserDeck & { ownerEmail: string; ownerName?: string; inDirectory?: boolean; archived?: boolean })[]).filter((d) => !d.archived);
  // By-person lists only real teammates (inDirectory) — never a system account like master@.
  const owners = Array.from(allDecks.filter((d) => d.inDirectory !== false).reduce((m, d) => { if (!m.has(d.ownerEmail)) m.set(d.ownerEmail, d.ownerName || d.ownerEmail.split("@")[0]); return m; }, new Map<string, string>()))
    .map(([ownerEmail, name]) => ({ ownerEmail, name })).sort((a, b) => a.name.localeCompare(b.name));
  const personDecks = personEmail ? allDecks.filter((d) => d.ownerEmail === personEmail) : [];
  const personName = owners.find((o) => o.ownerEmail === personEmail)?.name || (personEmail ?? "").split("@")[0];

  return (
    <AppShell fullHeight>
      <div className={`prez-hub${builder || editor ? " editing" : ""}${libCollapsed ? " lib-collapsed" : ""}`} ref={hubRef}>
        <aside className="prez-lib" aria-label="Presentation library" style={{ width: libWidth }}>
          <div className="prez-lib__head">
            <h2>Presentations</h2>
            <div className="prez-lib__headbtns">
              <button
                className="prez-libwrap"
                type="button"
                title="Collapse the list (or drag its right edge)"
                aria-label="Collapse presentations list"
                onClick={() => collapseLib(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 7-5 5 5 5M20 5v14" /></svg>
              </button>
              <button
                className={`prez-create-btn${view === CREATE ? " on" : ""}`}
                type="button"
                onClick={() => { setView(CREATE); setUserPreview(null); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Create
              </button>
            </div>
          </div>
          <span className="prez-count">
            {tab === "master" ? `${shown.length} decks` : tab === "sales" ? `${salesShown.length + userSalesDecks.length} decks` : tab === "mine" ? `${generalDecks.length} decks` : tab === "person" ? `${personDecks.length} decks` : tab === "archived" ? `${archivedQ.data?.length ?? 0} archived` : tab === "shared" ? `${shared.data?.length ?? 0} shared` : `${CATS.reduce((n, c) => n + c.items.length, 0)} slide templates`}
          </span>

          <div className="prez-tabrow">
            <div className="prez-tabsel">
              <select aria-label="Deck list" value={tab === "person" && personEmail ? `person:${personEmail}` : tab} onChange={(e) => { const v = e.target.value; if (v.startsWith("person:")) { setPersonEmail(v.slice(7)); setTab("person"); setUserPreview(null); } else { setPersonEmail(null); setTab(v as typeof tab); } }}>
                <option value="master">Master Decks</option>
                <option value="sales">Sales Decks</option>
                <option value="mine">My Decks</option>
                <option value="shared">Shared</option>
                <option value="slides">Slides</option>
                <option value="archived">Archived</option>
                {canSeeAdmin && owners.length > 0 && (
                  <optgroup label="By person">
                    {owners.map((o) => <option key={o.ownerEmail} value={`person:${o.ownerEmail}`}>{o.name} ({allDecks.filter((d) => d.ownerEmail === o.ownerEmail).length})</option>)}
                  </optgroup>
                )}
              </select>
              <svg className="prez-tabsel-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </div>
            <a className="prez-ppt-script" href="/docs/powerpoint-script.html" target="_blank" rel="noopener" title="PowerPoint Script — how to build slides with the hybrid method">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>
            </a>
          </div>

          <label className="prez-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "slides" ? "Search slides" : "Search presentations"} aria-label={tab === "slides" ? "Search slides" : "Search presentations"} />
          </label>

          {tab !== "slides" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 4px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted, #8a8ba3)", whiteSpace: "nowrap" }}>Download signature</span>
              <div className="prez-tabsel" style={{ flex: 1 }}>
                <select aria-label="Signature on the download's closing page" value={sigKey} onChange={(e) => setSigKey(e.target.value)} title="Whose CTA signature appears on the last page of the downloaded PPTX / PDF">
                  {SIG_PEOPLE.map((p) => <option key={p.key || "default"} value={p.key}>{p.label}</option>)}
                </select>
                <svg className="prez-tabsel-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
          )}

          <div className="prez-cards">
            {tab === "mine" && (
              <>
                {mine.isLoading && <SkeletonGrid count={4} min={260} />}
                {!mine.isLoading && (mine.data?.length ?? 0) === 0 && (
                  <div className="prez-yours-empty">
                    <p>You haven&apos;t created any decks yet. Use <strong>Create</strong> above to make one from any file.</p>
                  </div>
                )}
                {!mine.isLoading && generalDecks.length === 0 && (mine.data?.length ?? 0) > 0 && (
                  <div className="prez-yours-empty"><p>Your sales decks live under <strong>Sales Decks</strong>.</p></div>
                )}
                {generalDecks.map((d) => renderUserDeck(d))}
              </>
            )}
            {tab === "person" && (
              <>
                {all.isLoading && <SkeletonGrid count={4} min={260} />}
                {!all.isLoading && personDecks.length === 0 && (
                  <div className="prez-yours-empty"><p>{personName} hasn&apos;t created any decks.</p></div>
                )}
                {personDecks.map((d) => renderUserDeck(d))}
              </>
            )}
            {tab === "archived" && (
              <>
                {archivedQ.isLoading && <SkeletonGrid count={3} min={260} />}
                {!archivedQ.isLoading && (archivedQ.data?.length ?? 0) === 0 && (
                  <div className="prez-yours-empty"><p>Nothing archived. Archived decks are hidden from every list but can be restored here at any time.</p></div>
                )}
                {((archivedQ.data ?? []) as UserDeck[]).map((d) => renderUserDeck(d, true))}
              </>
            )}
            {tab === "shared" && (
              <>
                {shared.isLoading && <SkeletonGrid count={4} min={260} />}
                {!shared.isLoading && (shared.data?.length ?? 0) === 0 && (
                  <div className="prez-yours-empty"><p>Nothing shared with you yet. When a colleague shares a deck, it shows up here.</p></div>
                )}
                {(shared.data ?? []).map((d: { id: string; title: string; slug: string; ownerEmail: string; slideCount?: string | null; canvaUrl?: string | null; myRole?: string }) => {
                  const canEdit = d.myRole === "edit";
                  const stop = (e: React.MouseEvent) => e.stopPropagation();
                  return (
                    <div className={`prez-card${userPreview?.slug === d.slug ? " selected" : ""}`} key={d.id}
                      role="button" tabIndex={0} onClick={() => setUserPreview({ slug: d.slug, title: d.title })}>
                      <div className="prez-cbody compact">
                        <span className="prez-badge">{canEdit ? "Can edit" : "View only"}</span>
                        <div className="prez-ctitle">{d.title}</div>
                        <div className="prez-cmeta">From {d.ownerEmail}</div>
                        <div className="prez-icrow" onClick={stop}>
                          <a className="prez-ic primary" href={`/presentations/p/${d.slug}/`} target="_blank" rel="noopener noreferrer" title="Present"><IcoPlay /></a>
                          <a className="prez-ic" href={dlPptx(d.slug)} download title="Download PowerPoint"><IcoPpt /></a>
                          <a className="prez-ic" href={dlPdf(d.slug)} download title="Download PDF"><IcoPdf /></a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            {tab === "slides" && (
              <div className="prez-slidelist">
                {CATS.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || c.items.some((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))).map((c) => {
                  const items = c.items.filter((t) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || t.name.toLowerCase().includes(q.trim().toLowerCase()));
                  return (
                    <div className="prez-slcat" key={c.key}>
                      <div className="prez-slcat-name">{c.name}</div>
                      {items.map((t, i) => (
                        <button
                          type="button"
                          key={t.id}
                          className={`prez-slitem${slideViewer && slideViewer.cat.key === c.key && slideViewer.cat.items[slideViewer.i]?.id === t.id ? " on" : ""}`}
                          title={t.use}
                          onClick={() => setSlideViewer({ cat: c, i: c.items.findIndex((x) => x.id === t.id) })}
                        >
                          <span className="prez-slitem-dot" aria-hidden="true" />
                          {t.name}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {(tab === "master" || tab === "sales") && (tab === "sales" ? salesShown : shown).map(({ t, i }) => (
              <div
                key={t.title}
                className={`prez-card${t.featured ? " featured" : ""}${!t.ready ? " disabled" : ""}${t.notReady ? " notready" : ""}${view === i && !userPreview ? " selected" : ""}`}
                onClick={t.ready ? () => { setView(i); setUserPreview(null); } : undefined}
                role={t.ready ? "button" : undefined}
                tabIndex={t.ready ? 0 : undefined}
                onKeyDown={t.ready ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView(i); setUserPreview(null); } } : undefined}
                draggable
                title="Drag up or down to reorder"
                onDragStart={(e) => { dragTitle.current = t.title; e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); dropCard(t.title); }}
              >
                <div className="prez-cbody compact">
                  {!t.ready && <span className={`prez-badge${t.notReady ? " notready" : " soon"}`}>{t.notReady ? "Not ready" : t.badge}</span>}
                  <div className="prez-ctitle">{t.title}</div>
                  <div className="prez-cmeta">
                    {(t.meta || "").split("·")[0].trim()}
                    {t.updated ? ` · Updated ${new Date(t.updated + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </div>
                  <div className="prez-icrow" onClick={(e) => e.stopPropagation()}>
                    <a className="prez-ic primary" href={t.ready ? (t.slug ? `/presentations/p/${t.slug}/` : fresh(t.open)) : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!t.ready} title="Present"><IcoPlay /></a>
                    <button
                      className="prez-ic"
                      onClick={() => { if (canEditMaster && t.ready && t.slug) openMasterEditor(t.slug, t.title); }}
                      disabled={!t.ready || !canEditMaster || !t.slug}
                      title={canEditMaster ? "Edit text on this master deck" : "Admins can edit master decks"}
                    ><IcoEdit /></button>
                    <a className={`prez-ic${t.slug ? "" : " off"}`} href={dlPptx(t.slug)} aria-disabled={!t.slug} download title="Download PowerPoint"><IcoPpt /></a>
                    <a className={`prez-ic${t.slug ? "" : " off"}`} href={dlPdf(t.slug)} aria-disabled={!t.slug} download title="Download PDF"><IcoPdf /></a>
                    <button className="prez-ic" title="Share a public link" onClick={() => { setCopied(false); setShareSlug(t.slug ?? null); }}><IcoShare /></button>
                  </div>
                </div>
              </div>
            ))}
            {tab === "sales" && userSalesDecks.map((d) => renderUserDeck(d))}
          </div>

          {/* Super-admin only: reveal the archived master templates (e.g. the unapproved Town Hall),
              tucked at the bottom of the list. Everyone else never sees them. */}
          {canSeeAdmin && tab === "master" && (
            <button
              type="button"
              className={`prez-admin-templates${showArchived ? " on" : ""}`}
              onClick={() => setShowArchived((v) => !v)}
              title="Master templates and work-in-progress decks, visible only to you"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              {showArchived ? "Hide master templates" : "Master templates"}
              <span className="prez-admin-tag">Admin</span>
            </button>
          )}
        </aside>

        {/* draggable divider — drag left to shrink, drag fully shut to collapse */}
        <div className="prez-resizer" role="separator" aria-orientation="vertical" title="Drag to resize · drag fully left to hide" onMouseDown={startResize} />
        {/* slim tab to reopen the panel once it's collapsed */}
        <button className="prez-libtab" type="button" aria-label="Show presentations list" title="Show presentations" onClick={() => collapseLib(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>

        {/* RIGHT — selected presentation, or the create flow */}
        <div className="prez-stage">
          {editor ? (
            <SlideEditor id={editor.id} slug={editor.slug} title={editor.title} edits={editor.edits} mode={editor.mode || "full"} onClose={() => { setEditor(null); mine.refetch(); sales.refetch(); }} />
          ) : builder ? (
            <Builder id={builder.id} slug={builder.slug} title={builder.title} onClose={() => { setBuilder(null); mine.refetch(); }} />
          ) : view === CREATE ? (
            <CreatePane onCreated={(k) => { setTab(k === "sales" ? "sales" : "mine"); refetchDecks(); }} onBuild={(d) => { setTab("mine"); mine.refetch(); setBuilder(d); }} />
          ) : tab === "slides" ? (
            <SlidesTab viewer={slideViewer} setViewer={setSlideViewer} />
          ) : userPreview ? (
            <iframe key={userPreview.slug} src={`/p/${userPreview.slug}/${userPreview.at ? `#s${userPreview.at}` : ""}`} title={userPreview.title} allow="fullscreen clipboard-read clipboard-write" />
          ) : (tab === "master" || tab === "sales") && rightSrc ? (
            <iframe key={String(view)} src={rightSrc} title={rightTitle} allow="fullscreen clipboard-read clipboard-write" />
          ) : (
            <div className="prez-empty">{tab === "mine" ? "Create a deck, or select one on the left." : "Nothing to preview yet."}</div>
          )}
        </div>
      </div>

      <style>{`
        .prez-hub{position:relative;display:flex;flex:1;min-height:0;height:100%;background:var(--surface-2)}
        .prez-hub.editing .prez-lib{display:none}
        .prez-hub.editing .prez-stage{background:var(--surface-2)}
        .prez-lib{width:380px;flex-shrink:0;display:flex;flex-direction:column;background:var(--surface);border-right:1px solid var(--border);overflow-y:auto;padding:1.4rem 1.1rem 1.2rem}
        .prez-lib__head{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem;padding:0 .4rem 0}
        .prez-lib__head h2{margin:0;font-size:1.24rem;font-weight:600;color:var(--ink);letter-spacing:-.02em}
        .prez-count{display:block;font-family:ui-monospace,Menlo,monospace;font-size:.68rem;color:var(--muted);margin:.1rem .4rem .9rem}
        .prez-create-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .9rem;border:none;border-radius:999px;cursor:pointer;font-size:.82rem;font-weight:600;color:#fff;background:linear-gradient(135deg,#8b5cf6,var(--accent),#3b82f6);box-shadow:0 6px 16px rgba(99,102,241,.3);transition:filter .2s,transform .2s}
        .prez-create-btn:hover{filter:brightness(1.06);transform:translateY(-1px)}
        .prez-create-btn.on{box-shadow:0 0 0 3px rgba(99,102,241,.25),0 6px 16px rgba(99,102,241,.3)}
        .prez-search{display:flex;align-items:center;gap:.55rem;margin:.9rem .4rem 1rem;padding:.6rem .8rem;background:var(--surface-2);border:1px solid var(--border);border-radius:11px;color:var(--muted)}
        .prez-search input{border:none;background:none;outline:none;font-size:.9rem;color:var(--ink);width:100%}
        .prez-cards{display:flex;flex-direction:column;gap:.7rem}
        .prez-card{display:block;border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface);cursor:pointer;transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s,border-color .3s}
        /* resizable + collapsible presentations panel */
        .prez-resizer{flex:0 0 7px;align-self:stretch;cursor:col-resize;position:relative;background:transparent;z-index:6}
        .prez-resizer::before{content:"";position:absolute;top:0;bottom:0;left:2px;width:2px;border-radius:2px;background:transparent;transition:background .15s}
        .prez-resizer:hover::before{background:#cdb8ff}
        .prez-libtab{position:absolute;left:0;top:50%;transform:translateY(-50%);width:22px;height:82px;border:0;border-radius:0 12px 12px 0;background:linear-gradient(135deg,#8b5cf6,var(--accent),#3b82f6);color:#fff;cursor:pointer;display:none;align-items:center;justify-content:center;z-index:30;box-shadow:0 12px 34px rgba(99,102,241,.4)}
        .prez-hub.lib-collapsed .prez-lib,.prez-hub.lib-collapsed .prez-resizer{display:none}
        .prez-hub.lib-collapsed .prez-libtab{display:flex}
        .prez-hub.editing .prez-resizer,.prez-hub.editing .prez-libtab{display:none}
        .prez-lib__headbtns{display:flex;align-items:center;gap:.5rem}
        .prez-libwrap{width:30px;height:30px;flex:0 0 auto;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
        .prez-libwrap:hover{border-color:#dcd4ff;color:var(--accent)}
        .prez-card:hover{transform:translateY(-3px);box-shadow:0 22px 50px rgba(99,102,241,.16);border-color:var(--border)}
        .prez-card.selected{border-color:transparent;box-shadow:0 0 0 2px var(--accent),0 16px 40px rgba(99,102,241,.16)}
        .prez-card.disabled{opacity:.62;cursor:default}
        .prez-card.disabled:hover{transform:none;box-shadow:none;border-color:var(--border)}
        .prez-thumb{position:relative;aspect-ratio:16/10;overflow:hidden;background:linear-gradient(135deg,#f5edff,#eaf1ff)}
        .prez-thumb img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block;-webkit-user-drag:none;user-select:none}
        .prez-thumb.ph{display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 120% at 20% 10%,#efe7ff,transparent 60%),radial-gradient(120% 120% at 90% 90%,#e6eeff,transparent 55%),#faf9ff}
        .prez-glyph{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,var(--accent),#3b82f6);opacity:.22}
        .prez-badge{position:absolute;top:.6rem;left:.6rem;font-family:ui-monospace,Menlo,monospace;font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;padding:.28rem .55rem;border-radius:999px;background:rgba(255,255,255,.92);color:var(--accent);font-weight:700;backdrop-filter:blur(4px)}
        .prez-badge.soon{background:rgba(15,20,36,.55);color:#fff}
        .prez-badge.notready{background:#dc2626;color:#fff}
        .prez-card.notready{border-color:#f3b4b4;background:var(--surface-2)}
        .prez-card.notready .prez-thumb{filter:grayscale(1);opacity:.5}
        .prez-card.notready .prez-ctitle{color:#b91c1c}
        .prez-card.notready:hover{box-shadow:0 22px 50px rgba(220,38,38,.14);border-color:#dc2626}
        .prez-card.notready.selected{box-shadow:0 0 0 2px #dc2626,0 16px 40px rgba(220,38,38,.16)}
        .prez-cbody{padding:.8rem .9rem 1rem}
        .prez-ctitle{font-weight:600;color:var(--ink);font-size:1rem;letter-spacing:-.01em}
        .prez-cmeta{font-family:ui-monospace,Menlo,monospace;font-size:.68rem;color:var(--muted);margin-top:.28rem}
        .prez-actions{display:flex;gap:.4rem;margin-top:.8rem}
        .prez-mini{flex:1;text-align:center;font-size:.8rem;font-weight:500;padding:.5rem;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--ink);white-space:nowrap;text-decoration:none;cursor:pointer}
        .prez-mini.primary{border:none;background:linear-gradient(135deg,#8b5cf6,var(--accent),#3b82f6);color:#fff;box-shadow:0 6px 16px rgba(99,102,241,.3)}
        .prez-card.disabled .prez-mini{opacity:.6;cursor:default}
        .prez-tabs{display:flex;gap:.3rem;padding:0 0 .1rem}
        .prez-tab{flex:1;font-size:.82rem;font-weight:600;padding:.55rem .5rem;border-radius:9px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap}
        .prez-tab.on{background:var(--surface);color:var(--ink);border-color:var(--border);box-shadow:0 2px 8px rgba(23,18,54,.06)}
        .prez-tabrow{display:flex;gap:.4rem;align-items:stretch;padding:0 0 .1rem}
        .prez-tabsel{position:relative;flex:1;min-width:0}
        .prez-tabsel select{width:100%;appearance:none;-webkit-appearance:none;font:inherit;font-size:.86rem;font-weight:600;color:var(--ink);background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:.55rem 2rem .55rem .7rem;cursor:pointer;box-shadow:0 2px 8px rgba(23,18,54,.06)}
        .prez-tabsel select:hover{border-color:#c9bef1}
        .prez-tabsel select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
        .prez-tabsel-caret{position:absolute;right:.6rem;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
        .prez-ppt-script{display:inline-flex;align-items:center;justify-content:center;padding:.55rem;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:#8b5cf6;text-decoration:none;flex:0 0 auto}
        .prez-ppt-script:hover{background:#f4f0ff;border-color:#d9c9ff}
        .prez-exports{display:flex;gap:.35rem;margin-top:.5rem}
        .prez-xbtn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:.32rem;font-size:.72rem;font-weight:600;padding:.42rem .3rem;border-radius:8px;border:1px solid #e8e6f2;background:var(--surface-2);color:var(--body);cursor:pointer;text-decoration:none;white-space:nowrap}
        .prez-xbtn:hover{background:var(--surface);color:var(--ink);border-color:var(--border)}
        .prez-xbtn svg{flex:0 0 auto}
        .prez-xbtn.off{opacity:.4;pointer-events:none}
        /* compact deck card: no thumbnail, title + slides + updated date, one icon-button row */
        .prez-cbody.compact{position:relative;padding:.72rem .8rem .78rem}
        .prez-cbody.compact .prez-ctitle{font-size:.92rem;line-height:1.25}
        .prez-cbody.compact .prez-badge{position:static;display:inline-block;margin-bottom:.35rem;backdrop-filter:none}
        .prez-icrow{display:flex;gap:.34rem;margin-top:.6rem}
        .prez-ic{flex:1;display:inline-flex;align-items:center;justify-content:center;height:34px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--ink);cursor:pointer;text-decoration:none;padding:0}
        .prez-ic:hover{background:var(--surface-2);border-color:#c9bef1;color:#4338ca}
        .prez-ic.primary{border:none;background:linear-gradient(135deg,#8b5cf6,var(--accent),#3b82f6);color:#fff;box-shadow:0 5px 14px rgba(99,102,241,.3)}
        .prez-ic.primary:hover{color:#fff}
        .prez-ic:disabled,.prez-ic.off{opacity:.4;cursor:default;pointer-events:none}
        .prez-ic svg{display:block}
        .prez-ic.danger{color:#b91c1c}
        .prez-ic.danger:hover{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
        .prez-rename{width:100%;font:inherit;font-size:.92rem;font-weight:600;color:var(--ink);background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:.3rem .45rem;outline:none;box-shadow:0 0 0 3px rgba(99,102,241,.14)}
        .prez-slidelist{display:flex;flex-direction:column;gap:1rem;padding:.2rem 0}
        .prez-slcat{display:flex;flex-direction:column;gap:.15rem}
        .prez-slcat-name{font-size:.67rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:.1rem .5rem .2rem}
        .prez-slitem{display:flex;align-items:center;gap:.55rem;width:100%;text-align:left;font:inherit;font-size:.86rem;font-weight:500;color:var(--ink);background:transparent;border:1px solid transparent;border-radius:9px;padding:.48rem .6rem;cursor:pointer}
        .prez-slitem:hover{background:var(--surface-2);border-color:var(--border)}
        .prez-slitem.on{background:var(--surface);border-color:#c9bef1;color:#4338ca}
        .prez-slitem-dot{width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,var(--accent));flex:0 0 auto}
        .prez-yours-empty{display:flex;flex-direction:column;align-items:center;gap:.9rem;text-align:center;color:var(--muted);font-size:.9rem;padding:2.4rem 1rem}
        .prez-yours-empty .prez-mini{flex:0 0 auto;padding:.55rem 1.3rem}
        .prez-stage{flex:1;min-width:0;display:flex;background:var(--surface)}
        .prez-stage iframe{flex:1;width:100%;border:none;display:block;min-height:0}
        .prez-empty{margin:auto;color:var(--muted);font-size:.95rem}
        .prez-modal-back{position:fixed;inset:0;z-index:100;background:rgba(17,20,36,.42);display:flex;align-items:center;justify-content:center;padding:1.5rem}
        .prez-modal{background:var(--surface);border-radius:16px;box-shadow:0 30px 80px rgba(17,20,36,.35);max-width:520px;width:100%;padding:1.6rem 1.7rem}
        .prez-modal h3{margin:0 0 .3rem;font-size:1.15rem;color:var(--ink)}
        .prez-modal p{margin:0 0 1rem;font-size:.86rem;color:var(--muted);line-height:1.45}
        .prez-linkrow{display:flex;gap:.5rem;align-items:center}
        .prez-linkrow input{flex:1;min-width:0;font-size:.84rem;padding:.6rem .7rem;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);color:var(--ink)}
        .prez-modal-actions{display:flex;gap:.5rem;margin-top:1rem;justify-content:flex-end}
        .prez-mbtn{font-size:.82rem;font-weight:600;padding:.55rem 1.1rem;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
        .prez-mbtn.primary{border:none;background:linear-gradient(135deg,#8b5cf6,var(--accent),#3b82f6);color:#fff}
        .prez-mbtn.danger{border:none;background:#e5484d;color:#fff}
        .prez-mbtn.danger:hover{background:#d33745}
        .prez-mbtn:disabled{opacity:.55;cursor:default}
        .prez-shared-h{margin:1.2rem .3rem .3rem;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
        .prez-sharebox{margin-top:1.1rem;padding-top:1rem;border-top:1px solid #eceaf4}
        .prez-toggle{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-start;font-size:.82rem;color:var(--body);line-height:1.4}
        .prez-toggle>input{margin-top:.15rem;width:16px;height:16px;accent-color:var(--accent);flex-shrink:0}
        .prez-toggle>span{flex:1;min-width:60%}
        .prez-toggle strong{color:var(--ink)}
        .prez-people-h{margin:1rem 0 .5rem;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
        .prez-people{max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:.15rem;border:1px solid #eceaf4;border-radius:10px;padding:.35rem}
        .prez-people-empty{padding:.6rem;color:var(--muted);font-size:.82rem}
        .prez-person{display:flex;gap:.55rem;align-items:center;justify-content:space-between;padding:.35rem .5rem;border-radius:8px;font-size:.85rem;color:var(--ink)}
        .prez-person:hover{background:var(--surface-2)}
        .prez-person.on{background:var(--surface-2)}
        .prez-person label{display:flex;gap:.55rem;align-items:center;cursor:pointer;flex:1;min-width:0}
        .prez-person label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .prez-person input{width:15px;height:15px;accent-color:var(--accent);flex-shrink:0}
        .prez-role{flex-shrink:0;font-size:.74rem;padding:.25rem .4rem;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:#4338ca;font-weight:600;cursor:pointer}
        .prez-admin-templates{margin:1rem .2rem .2rem;display:flex;align-items:center;gap:.5rem;width:calc(100% - .4rem);padding:.6rem .8rem;border:1px dashed var(--border);border-radius:10px;background:transparent;color:var(--muted);font-size:.82rem;font-weight:600;cursor:pointer}
        .prez-admin-templates:hover{border-color:#dcd4ff;color:var(--accent);background:var(--surface-2)}
        .prez-admin-templates.on{border-style:solid;border-color:#dcd4ff;color:var(--accent)}
        .prez-admin-templates .prez-admin-tag{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;font-weight:700;background:var(--surface-2);color:var(--muted);padding:.15rem .4rem;border-radius:999px}
        @media(max-width:900px){.prez-hub{flex-direction:column}.prez-lib{width:100%!important;max-height:48vh;border-right:none;border-bottom:1px solid var(--border)}.prez-resizer,.prez-libtab{display:none}}
      `}</style>


      {shareSlug && (
        <div className="prez-modal-back" onClick={() => { setShareSlug(null); setShareDeck(null); }}>
          <div className="prez-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Share presentation</h3>
            <p>Anyone with this link can view the presentation and download the PowerPoint or PDF, no login required. Send it to leads or prospects.</p>
            <div className="prez-linkrow">
              <input value={shareUrl} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Public link" />
              <button className="prez-mbtn primary" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} }}>{copied ? "Copied" : "Copy"}</button>
            </div>

            {shareDeck && (
              <div className="prez-sharebox">
                <div className="prez-toggle">
                  <input type="checkbox" checked={shareDeck.companyShared} onChange={(e) => setShareDeck({ ...shareDeck, companyShared: e.target.checked })} />
                  <span><strong>Share with everyone at Acme</strong><br />Shows up under Shared for every colleague, no link needed.</span>
                  {shareDeck.companyShared && (
                    <select className="prez-role" value={shareDeck.companyRole} onChange={(e) => setShareDeck({ ...shareDeck, companyRole: e.target.value as Role })}>
                      <option value="view">Can view</option>
                      <option value="edit">Can edit</option>
                    </select>
                  )}
                </div>

                <div className="prez-people-h">Or share with specific people</div>
                <div className="prez-people">
                  {(colleagues.data ?? []).length === 0 && <div className="prez-people-empty">No colleagues found.</div>}
                  {(colleagues.data ?? []).map((p: { email: string; name: string | null }) => {
                    const entry = shareDeck.sharedEmails.find((s) => s.email === p.email);
                    const on = !!entry;
                    return (
                      <div key={p.email} className={`prez-person${on ? " on" : ""}`}>
                        <label>
                          <input type="checkbox" checked={on} onChange={(e) => setShareDeck({ ...shareDeck, sharedEmails: e.target.checked ? [...shareDeck.sharedEmails, { email: p.email, role: "view" as Role }] : shareDeck.sharedEmails.filter((x) => x.email !== p.email) })} />
                          <span>{p.name || p.email}</span>
                        </label>
                        {on && (
                          <select className="prez-role" value={entry!.role} onChange={(e) => setShareDeck({ ...shareDeck, sharedEmails: shareDeck.sharedEmails.map((s) => s.email === p.email ? { ...s, role: e.target.value as Role } : s) })}>
                            <option value="view">Can view</option>
                            <option value="edit">Can edit</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="prez-modal-actions">
              <a className="prez-mbtn" href={shareUrl} target="_blank" rel="noopener noreferrer">Open</a>
              {shareDeck ? (
                <button className="prez-mbtn primary" disabled={setSharing.isPending} onClick={() => setSharing.mutate({ id: shareDeck.id, companyShared: shareDeck.companyShared, companyRole: shareDeck.companyRole, sharedEmails: shareDeck.sharedEmails })}>{setSharing.isPending && <Spinner style={{ marginRight: 6 }} />}{setSharing.isPending ? "Saving…" : "Save sharing"}</button>
              ) : (
                <button className="prez-mbtn" onClick={() => { setShareSlug(null); setShareDeck(null); }}>Close</button>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
