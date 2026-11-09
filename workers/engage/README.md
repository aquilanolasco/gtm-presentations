# Engage: prospect sales decks from a website (Create from a Master Deck)

A rep pastes a prospect's website in Presentations > Create > Sales deck. Two minutes later the
deck is live under Sales Decks: co-branded cover with the prospect's logo (and a photo of their
property when the site has one), opening slides written for that prospect, the Short Pack master
slides, and the closing page signed by the rep. PowerPoint and PDF are built at the same time.

## Pieces

| Where | What |
|---|---|
| `web-deck/app/engage/page.tsx` (Presentation Agent repo) | The deck TEMPLATE. Built once, deployed to `/var/www/presentation-public/_engage/deck/` by `web-deck/deploy-engage-template.sh`. Reads `spec.json` next to its own `index.html` at runtime. |
| `src/app/presentations/ProspectCreate.tsx` | The Create pane flow (look up site, pick logo and photo, notes, presenter, master slides). |
| `src/app/api/create/scout` | Runs `engage-scout.mjs` (headless Chrome) for the look-up. |
| `src/app/api/create/engage` | Queues the job: a `presentations` row with `engine = "engage"`, `kind = "sales"`, the ask in `brief`. GET returns the presenter roster. |
| `src/app/api/create/next?engine=engage` | The worker's job feed. Without the param the Mac relay only ever gets non-engage jobs. |
| `src/server/engage/presenters.ts` | Presenter roster: `people` table + Meetings booker members (booking links), one entry per person. |
| `workers/engage/engage-logosearch.mjs` | The logo decision: site candidates + a web image search for "<client> logo" (Google first, then DuckDuckGo's index since Google walls the VPS), every candidate downloaded, Claude (vision) picks the official dark or coloured one. White-only logos are recoloured by `engage-assets.mjs darkenLogo` (brand dark colour or black). Never a badge behind a logo. |
| `workers/engage/*.mjs` | The VPS worker. Copied by hand to `/var/www/acme-gtm-workers/engage/` (deploy.sh does not ship workers), PM2 process `engage-worker`. |
| `public/pp-edit.js` | Waits for runtime-rendered slides before booting, so the Slide Editor works on these decks. |

Worker pipeline per job: `read` (deep scout of the site, logo chosen by Claude from the site and the web,
white-only logos recoloured, cover photo prepared) -> `write` (Claude writes the opening slides from the site copy and the rep's
notes; Acme claims come only from the fact sheet in `engage-writer.mjs`) -> `export` (copy
the template, write `spec.json`, capture every slide with Chrome mapping `<APP_DOMAIN>` to
127.0.0.1, build PPTX + PDF + the `--jane/--john/--alex/--sam` signature variants) ->
`publish` (viewer wrapper, `thumb.png`, row marked ready).

Output layout, identical to every other deck:
`/var/www/presentation-public/<slug>/{index.html, deck/, <slug>.pptx, <slug>.pdf, thumb.png}` and
`/var/www/presentation-exports/<slug>/*.pptx|pdf` (authed downloads).

## Operating it

```bash
# ship worker changes
scp workers/engage/*.mjs root@<VPS_HOST>:/var/www/acme-gtm-workers/engage/
ssh root@<VPS_HOST> pm2 restart engage-worker

# first start
ssh root@<VPS_HOST> 'cd /var/www/acme-gtm-workers && pm2 start engage/engage-worker.mjs --name engage-worker && pm2 save'

# logs
ssh root@<VPS_HOST> pm2 logs engage-worker --lines 100

# run the whole pipeline for one prospect without the app (writes a real deck dir)
ssh root@<VPS_HOST> 'cd /var/www/acme-gtm-workers/engage && node engage-test.mjs https://www.example-hotels.com example-test "notes for the writer"'

# template change (web-deck repo): rebuild + redeploy + refresh every existing engage deck's index.html
cd ~/presentation-agent/web-deck && ./deploy-engage-template.sh
```

Env (in `/var/www/acme-gtm-workers/.env`): `ANTHROPIC_API_KEY`, `RELAY_SECRET` (same as the app's).
Optional: `ENGAGE_MODEL` (default `claude-opus-5-5`), `ENGAGE_APP` (default `http://127.0.0.1:3000`),
`APP_DOMAIN` (the app's public host, default `app.example.com`; deck URLs are captured from it).
Node deps installed in `/var/www/acme-gtm-workers`: puppeteer (already there), `@anthropic-ai/sdk`, `pptxgenjs`, `pdf-lib`, `sharp`.

A failed job shows "Failed" on its card with the reason; fix and re-queue by setting the row back to
`status = 'generating'`. Re-running a deck regenerates its copy (the writer is not deterministic).
