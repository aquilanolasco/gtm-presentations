# Tech stack

Versions are taken from the package manifests: the GTM Workspace app's `package.json` (the app
this module runs inside; this repo's root `package.json` carries the same versions for the subset the
module needs), `engine/create-engine/package.json`, `engine/engine-v2/package.json` and
`engine/web-deck/package.json`. A caret (`^`) means the range in the manifest, not a lockfile pin.
The engage worker's libraries were installed on the server without a manifest; this export lists them
in the root `package.json`, and those ranges are given below. Anything marked "not pinned" is installed
on a machine and has no version recorded in this repo.

## App (the Presentations module inside GTM Workspace)

| Piece | Version | Why |
|---|---|---|
| Next.js (App Router) | 16.2.9 | One framework for the UI, the tRPC endpoint and the file-handling route handlers (uploads, spool writes, deck files). Built with `output: "standalone"` so the VPS runs a single `server.js` without `node_modules` installs. |
| React / React DOM | 19.2.4 | UI runtime for the module page, Create pane, Builder and Slide Editor frame. |
| TypeScript | ^5 | Type safety end to end; tRPC infers client types from the router. |
| tRPC (`@trpc/server`, `@trpc/client`, `@trpc/react-query`) | ^11.18.0 | Typed queries and mutations for list, share, rename, archive and delete. No hand-written REST client. |
| TanStack Query (`@tanstack/react-query`) | ^5.101.2 | Caching and polling under tRPC. The Create pane, Builder and deck lists poll `presentations.get` / `listMine` / `listSales` with `refetchInterval` until a deck is `ready` or `failed`. |
| Zod | ^4.4.3 | Input validation for every tRPC procedure. |
| Drizzle ORM | ^0.45.2 | Typed schema and queries over Postgres, including `jsonb` containment (`shared_emails @> ...`) via the `sql` helper. |
| drizzle-kit | ^0.31.10 | Schema push and migrations (`drizzle.config.ts`). |
| node-postgres (`pg`) | ^8.22.0 | Pooled connection (max 10) to the self-hosted Postgres on the same VPS. `@neondatabase/serverless` ^1.1.0 is still listed from an earlier hosted-Postgres setup; this module does not use it. |
| NextAuth (Auth.js v5, `next-auth`) | ^5.0.0-beta.31 (`@auth/core` ^0.41.2) | Google OAuth sign-in, JWT sessions, a domain allowlist in the `signIn` callback, and an `auth()` helper usable in route handlers, tRPC context and middleware. |
| Tailwind CSS + PostCSS | ^4 (`@tailwindcss/postcss` ^4) | Styling for the app; `postcss.config.mjs` loads the Tailwind v4 PostCSS plugin. Much of the module also uses scoped class names in plain CSS. |
| ESLint | ^9 (`eslint-config-next` 16.2.9) | Lint. |
| TipTap (`@tiptap/react`, `starter-kit`, image / placeholder / table extensions) | ^3.28.0 | Rich-text editor used elsewhere in GTM Workspace. Listed in the host app's manifest; the Presentations module does not import it. |

## Engine

| Piece | Version | Where | Why |
|---|---|---|---|
| Anthropic API (Claude) | Messages API, `anthropic-version: 2023-06-01`; `@anthropic-ai/sdk` ^0.52.0 | create-engine (raw `fetch`), engage worker (SDK), engine-v2 composer | Structures source content into a slide array, authors decks from notes, edits single slides, writes prospect intro slides, picks logos and cover photos with vision, checks rendered slides. Model ids come from env with code defaults (`CREATE_MODEL`, `GEN_MODEL`, `ENGAGE_MODEL`, `COMPOSER_MODEL`). |
| Gamma API | `public-api.gamma.app/v1.0` | `engine/create-engine/build-gamma.mjs` | Legacy "Create with Gamma" engine. The upload route now always sets `engine = "claude"`; the relay still handles `gamma` rows. |
| Canva Connect | external helper (`CANVA_PY`), not included | relay (disabled), `presentations.canva_url` | Import a PPTX into an editable Canva design and store its link. The relay's Canva step is switched off; the column and the card link remain. |
| pptxgenjs | ^4.0.1 (create-engine and root) | `pptx-native.mjs`, `engage-export.mjs` | PowerPoint output. The worker writes one full-bleed slide image per 13.333 x 7.5 in slide; `pptx-native.mjs` maps `deck.json` to native, editable text boxes and tables. |
| pdf-lib | ^1.17.1 | `engage-export.mjs` | Assembles captured slides into a PDF (JPEG per page, 3200 x 1800 pt). |
| sharp | ^0.34.5 | engage worker | Logo and photo preparation, recolouring white logos, thumbnails (`thumb.png`, Saved-slide WebP). |
| puppeteer (headless Chrome) | ^24.43.1 | engage worker | Reads prospect sites that block plain fetches and draw logos with JS; captures every slide of the live deck for export. |
| Playwright | ^1.61.1 (engine-v2 dev dependency) | `engine-v2/qa/*`, external exporter | Screenshots for the QA loop and the relay's export capture. |
| GSAP | ^3.15.0 (engine-v2 and web-deck) | `engine-v2/gsap-engine.js`, web-deck slides | Slide choreography (8 presets in the spec schema), self-hosted, reduced-motion safe. Chosen over Framer Motion because engine-v2 decks are single-file vanilla HTML. |
| Ajv + ajv-formats | ^8.20.0 / ^3.0.1 | engine-v2 | Hard validation of every deck spec against `deck-spec.schema.json` (JSON Schema 2020-12) before rendering. |
| Next.js (web-deck) | 16.2.10, React 19.2.4 | `engine/web-deck` | Builds the deck templates as static exports (`DECK_EXPORT=1`, base path baked in). |
| framer-motion, three, @react-three/fiber, @react-three/drei, lucide-react, dotted-map | ^12.42.2, ^0.185.1, ^9.6.1, ^10.7.7, ^1.25.0, ^3.1.0 | web-deck | Animation, 3D cover elements, icons and map graphics inside the hand-built master-deck components. |
| clsx, tailwind-merge, class-variance-authority | ^2.1.1, ^3.6.0, ^0.7.1 | web-deck | Class composition for the deck components. |
| Python 3: PyMuPDF, python-pptx, python-docx, Pillow | not pinned | `create-engine/ingest.py`, `copy-deck.mjs` | Extract text, images and links from PDF / PPTX / DOCX, render page images for vision, crop headshots. |
| Whisper (`mlx_whisper` first, then `openai-whisper`) | not pinned, optional | `ingest.py` | Local transcription of uploaded or recorded audio. |
| BM25 slide search (stdlib Python) | n/a | `engine-v2/design-system/scripts` | Grounds the composer in layout, copy and chart guidance per slide type. |
| System tools | not pinned | relay / worker | LibreOffice `soffice` (PPTX to PDF on the Gamma and bench paths), macOS `sips` (thumbnails), `pdftotext` and `unzip` (reading files attached to "add a slide"). |

## Infrastructure

| Piece | Why |
|---|---|
| One KVM VPS (`<VPS_HOST>`) | Runs the app, Postgres, nginx, the engage worker and other workers. Small by design (the engine design notes size it at 2 vCPU / 8 GB), which is why heavy Create jobs run on a Mac. |
| Self-hosted Postgres on the VPS | Local hop, no cold starts, no quota limits. `DATABASE_URL` points at `localhost:5432` in production. |
| PM2 | Keeps the app (`server.js` on port 3000) and `engage-worker` alive, restarts on deploy, survives reboots (`pm2 save`). |
| nginx | TLS front, reverse proxy to the app, serves deck folders and exports straight from disk, and gates static decks with `auth_request` against the app's `/api/auth-check`. |
| Edge cache (CDN) | Sits in front of nginx. Exports use a `?v=` / `?t=` cache-busting token so a rebuilt file is never served stale. |
| rsync over ssh + a cross-machine lock | Deploy: build locally, rsync the Next standalone output, restart PM2. A lock directory on the VPS keeps two machines from deploying at once. |
| macOS LaunchAgent | Runs the Create relay persistently on a Mac (KeepAlive, RunAtLoad). |
| Google OAuth | One sign-in for the app and every gated static surface. |
