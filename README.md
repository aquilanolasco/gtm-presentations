# gtm-presentations

The **Presentations module** of an internal sales and marketing app called **GTM Workspace**,
exported together with the **deck engine** that powers it.

GTM Workspace is a Next.js app used by one company's go-to-market team. Its Presentations module
lets people browse the company's master decks, generate new decks from any file, build prospect
sales decks from a website address, edit decks on the canvas, export them to PowerPoint and PDF, and
share them inside the company or through a public link. This repo holds that module plus every
moving part behind it: the job queue, the local generation relay, the VPS worker, the deck templates,
the edit runtime and the viewer.

> **This is a sanitized export.** Brand assets (logos, fonts, illustrations, product screenshots),
> client and prospect decks, slide copy, the master-slide library, people data, photos and other
> media, and every secret were removed. They are replaced by neutral placeholders that keep the same
> shape: sample copy with the same fields and bullet counts, a neutral colour palette, the Inter
> font, `Acme` as the company name, `Jane Doe` style names, `example.com` addresses, and
> env-variable reads where a key or host used to be. The slide library (`engage-library.json`) ships
> 8 sample entries across 2 decks (`intro`, `shortpack`) with the real schema; the real master-slide
> library was replaced with samples. Logic, data flow, file layout and function names are unchanged.

## Placeholders used in these docs

| Placeholder | Meaning |
|---|---|
| `<APP_DOMAIN>` | Public hostname of the app (code default `app.example.com`) |
| `<PREVIEW_DOMAIN>` | Hostname of the preview environment |
| `<VPS_HOST>` | The single KVM VPS that runs the app, the database, nginx and the worker |
| `<APP_DIR>` | Folder on the VPS holding the app's Next standalone build |
| `<WORKERS_DIR>` | Folder on the VPS holding the background workers (`/var/www/acme-gtm-workers`) |

## Screens and user flows

The module lives at `/presentations` inside the app shell (left sidebar, Google sign-in).

| Screen | What it does |
|---|---|
| **Master Decks** tab | The company's hand-built decks (`acme-introduction-deck`, `acme-sales-deck`, `acme-short-pack`, `acme-proposal-deck`, ...). Card list on the left, live preview on the right, Present / PPTX / PDF / Share. |
| **Sales Decks** tab | Every teammate's prospect decks (`kind = "sales"`), visible to the whole team. Owner or super admin can edit or archive. |
| **My Decks** tab | Decks the signed-in person created. Status chip while generating, then Present, Edit, Share, PPTX, PDF, Archive. |
| **Shared** tab | Decks other people shared with me (company-wide or by email), tagged "Can edit" or "View only". |
| **Slides** tab | The slide-template gallery the generator can use, the master-slide library, and Saved slides (a master slide a rep edited and kept). |
| **By person** / **Archived** | Super admin views: every deck grouped by owner; soft-deleted decks with Restore and Delete forever. |
| **Create** pane | Step 1 picks General (lands in My Decks) or Sales (lands in Sales Decks). General: drop any file, paste text or record a voice memo, then "Create with Claude". Sales: paste a prospect's website, pick logo and cover photo, add notes, choose the presenter and which master slides follow. A live progress panel streams stages and log lines. |
| **Builder** | Live builder for generated decks: edit slide text, switch a slide's template, regenerate one slide or change it with a prompt. |
| **Slide Editor** | On-canvas editing. Full mode (master decks): move, resize, colours, fonts, words. Sales mode (generated sales decks): words, text size, photos, hide items, hide a slide, add a slide written by Claude, save a slide for reuse. |
| **Present** | Fullscreen viewer at `/presentations/p/<slug>` (authed) or `/public/presentations/<slug>` (public), with Share, Full screen, signature and currency pickers, and PPTX/PDF downloads. |

## Repo map

```
src/
  app/presentations/        Module UI: page.tsx (tabs, cards, share dialog), CreatePane, ProspectCreate,
                            Builder, SlideEditor, SlidesTab, [deck]/page.tsx (deep link)
  app/api/create/           Job queue: upload (POST /api/create), engage queue, scout, edit, and the
                            relay/worker endpoints next, progress, done
  app/api/presentations/    Slide Editor server side: edits, hidden, image, add-slide, save-slide, saved-slides
  app/api/auth, api/trpc,   App glue: NextAuth handlers, tRPC fetch adapter, nginx auth_request target
  api/auth-check
  app/layout.tsx, login/,   App glue: trimmed root layout, sign-in page, redirect to /presentations
  page.tsx
  proxy.ts                  Next 16 proxy (middleware): login gate with the public exceptions
  server/db/                Drizzle client (pg Pool) and schema: presentations, people (trimmed)
  server/trpc/              tRPC context (session, "View as") and routers: presentations, admin (stub)
  server/engage/            Deck file helpers (spec.json, edits, re-export markers) and the presenter roster
  lib/                      NextAuth config, identity helpers, tRPC client, URL state hook, slide library copy
  components/               AppShell stub, providers, small shared UI (confirm dialog, spinner, skeleton, theme)
public/pp-edit.js           Deck edit runtime: applies saved edits on playback, powers on-canvas editing
public/brand/               Placeholder logo
workers/engage/             VPS worker for prospect sales decks (scout, logo search, writer, export)
engine/create-engine/       Local relay (Mac) + "Create with Claude" generator + ingest + Gamma path + bench tools
engine/engine-v2/           Spec-driven engine: JSON Schema deck spec, composer, web renderer, design tokens,
                            slide search, brand validator, QA scripts
engine/web-deck/            Next.js deck templates: the engage template (reads spec.json), the generated-deck
                            shell, DeckShell chrome, slide library loader, template deploy script
engine/viewer/              _viewer.html: the fullscreen Present page nginx serves for every deck
docs/                       TECH_STACK, ARCHITECTURE, DEPLOY, ENGINE
```

## Where to start

1. `docs/ARCHITECTURE.md` for the big picture (app, nginx, VPS, workers, local relay).
2. `docs/ENGINE.md` for how a deck is created, rendered, edited, exported and shared.
3. `src/server/db/schema/presentations.ts`, the one table everything hangs off.
4. `src/app/api/create/next/route.ts`, the job feed both background consumers poll.
5. `engine/create-engine/relay.mjs` and `workers/engage/engage-worker.mjs`, the two consumers.

## Running locally

### What is and is not here

This repo carries the module plus a thin layer of app glue so it runs on its own: a trimmed root
layout and providers (`src/app/layout.tsx`, `src/components/Providers.tsx`, `TRPCProvider.tsx`), a
`/login` page, `/` redirecting to `/presentations`, the NextAuth and tRPC route handlers, the
`/api/auth-check` endpoint nginx calls, `src/proxy.ts` (the Next 16 login gate), and stubs for the
parts of GTM Workspace the module touches: a minimal `AppShell`, an `admin` router with only
`myProfile`, and a `people` table trimmed to the fields the module reads. The other modules, the full
app shell (navigation, role-gated menus) and the database-backed role tables are not included.
`next.config.ts` is trimmed to `output: "standalone"` (what `docs/DEPLOY.md` ships) plus a noindex
header. The root `tsconfig.json` excludes `engine/`.

### App (Next.js)

Prerequisites: Node 20+, a Postgres database, a Google OAuth client (web application type, redirect
URI `http://localhost:3000/api/auth/callback/google`).

1. `npm install`
2. `cp .env.example .env.local` and fill the App section (`DATABASE_URL`, `AUTH_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPER_ADMIN_EMAILS`, `RELAY_SECRET`, `APP_DOMAIN`,
   `NEXT_PUBLIC_APP_DOMAIN`). Sign-in is limited to the company domains in `src/lib/auth.ts`
   (placeholders `example.com` / `example.org`) plus the external-partner allowlist; set them to your
   own domain.
3. `npm run db:push` (drizzle-kit creates `presentations` and `people`).
4. `npm run dev`, sign in, open `http://localhost:3000/presentations`.

Local caveats: decks, exports and the job spool live on disk under `/var/www/presentation-*`
(see `docs/ENGINE.md`). Without those folders the lists, sharing and tRPC procedures work, but
uploads to Create fail with a spool error and deck previews have nothing to load. To exercise Create
locally, make `/var/www/presentation-spool` and `/var/www/presentation-public` writable or change the
constants in the routes.

### Engine parts

Each engine piece runs on its own; none of them is bundled into the Next build.

| Piece | How to run it |
|---|---|
| **Engage worker** (`workers/engage`) | Needs Node 20+ and its dependencies (`puppeteer` with its Chrome, `sharp`, `pptxgenjs`, `pdf-lib`, `@anthropic-ai/sdk`; listed in the root `package.json`, installed in `<WORKERS_DIR>` on the server), and the engage template deployed at `/var/www/presentation-public/_engage/deck/engage.html`. Put `ANTHROPIC_API_KEY`, `RELAY_SECRET`, `APP_DOMAIN` (and `ENGAGE_APP` if the app is not on `127.0.0.1:3000`) in `../.env`, then `node engage-worker.mjs --once` for one poll, or `node engage-test.mjs <url> <slug> "<notes>"` to run the whole pipeline for one prospect without the app. |
| **Local relay** (`engine/create-engine`) | Needs Node 20+, `npm install` (pptxgenjs), a Python 3 with PyMuPDF, python-pptx, python-docx and Pillow (Whisper optional, for audio), ssh access to the VPS, and the external exporter scripts in `EXPORT_DIR`. Fill `relay.env`, then `./run-relay.sh`. The generator also runs alone: `python3 ingest.py <file> <assetsDir> > ing.json` then `node generate.mjs --ingest ing.json --assets <assetsDir> --title "T" --out <deckDir>`. |
| **Engine v2** (`engine/engine-v2`) | `npm install`, then `node build-manifest.mjs <assetsDir>`, `node composer/compose.mjs --brief brief.json --out builds/deck.json`, `node render-web.mjs --spec builds/deck.json --out builds/deck.html --embed`. Populate `vendor/` with the GSAP builds and add the design-system CSVs first (see `engine/engine-v2/design-system/README.md`). |
| **Web deck templates** (`engine/web-deck`) | A partial export: the library loader renders sample slides (`components/library/sample-slides.tsx`) in place of the master-deck markup. It carries its own `tsconfig.json` (`@/` alias), `lib/asset.ts` and the `components/sales/currency-*` helpers. `npm install`, `npm run dev`, open `/engage` (renders a demo spec when no `spec.json` sits next to it). Static build for the server: `./deploy-engage-template.sh` (see `docs/DEPLOY.md`). |
| **Viewer** (`engine/viewer/_viewer.html`) | A static file; copy it to `/var/www/presentation-public/_viewer.html`. |

## Further reading

- `docs/TECH_STACK.md`: versions and the reason for each piece.
- `docs/ARCHITECTURE.md`: components, auth, nginx gate, VPS layout, local relay.
- `docs/DEPLOY.md`: worktrees, deploy lock, standalone rsync, PM2, env handling, worker and template deploys.
- `docs/ENGINE.md`: data model, API, Create and engage pipelines, templates, edits, exports, sharing.
