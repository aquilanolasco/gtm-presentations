# Presentation viewer (`_viewer.html`)

Source of the fullscreen viewer page nginx serves for every deck opened in Present mode:

- internal, authed: `<APP_DOMAIN>/presentations/p/<slug>[/<page>]`
- public, no auth: `<APP_DOMAIN>/public/presentations/<slug>[/<page>]`

nginx (`/etc/nginx/snippets/acme-gtm-locations.conf`) answers both with `try_files /_viewer.html`
from `/var/www/presentation-public/`. The page iframes `/p/<slug>/deck/` and draws the top bar:
Currency (internal), Signature (internal), PPTX, PDF, Share, Full screen, Presentations (internal).

Deploy (a plain file copy, no build; back up the live one first):

```bash
ssh root@<VPS_HOST> "cp /var/www/presentation-public/_viewer.html /var/www/presentation-public/_viewer.html.bak-$(date +%Y%m%d)"
scp ~/presentation-agent/viewer/_viewer.html root@<VPS_HOST>:/var/www/presentation-public/_viewer.html
```

Currency: the bar posts `{type:"ppSetCur", cur}` into the deck iframe; decks built on
`components/sales/currency-control.tsx` (the engage template and the master Sales deck)
convert their figures and answer `{type:"ppCur", cur, base}`. A deck that never answers keeps the
picker hidden. The pick is stored per browser under `localStorage.ppCur` (the same key the decks
and `pp-currency.js` use) and the Share link carries `?cur=` when it differs from the deck's base.

Signatures: the picker keys (`jane`, `john`, ...) are sample presenters. Download variants are
`<slug>--<key>.(pptx|pdf)`, so the keys must match whatever the export worker generates.
