/* Acme deck edit runtime — ONE script for both playback and editing, so element ids always match.
   Playback: stable data-eid on every editable box (text leaf or image), then applies the saved patch
   (window.__PP_EDITS or ./edits.json). Editing (window.__PP_EDIT===1 or ?edit=1):
     full mode (master decks): click a box to select it (a handle overlay appears), drag to MOVE it, drag a
       handle to RESIZE it, and a floating toolbar gives text colour + fill colour + font/size/weight/align;
       double-click text to edit the words.
     sales mode (engagement decks, window.__PP_EDIT_MODE==="sales" or ?mode=sales, the default on a deck
       whose <html> carries data-engage): the words, the text size, the photos, and which items show. Click
       text to edit it in place, − / + change its size (never past what fits the slide), click a photo for
       Replace / Reframe, hover a person / card / bullet / chip for Hide. Fonts, colours and layout stay
       exactly as designed.
   Every change is applied live and posted to the parent app as {type:'ppEdits', edits} for autosave.
   Patch per eid: { text?, html?, fontScale?, color?, bg?, fontSize?, fontWeight?, fontStyle?, textAlign?,
                    fontFamily?, imgSrc?, x?, y?, w?, h?, hide? }
   Element ids: master decks key by slide INDEX ("t0.3"); engagement decks key by the slide's data-sid
   ("tcover.3"), so hiding or adding a slide never shifts another slide's saved edits. */
(function () {
  if (window.__ppEditInit) return;
  // Decks rendered at runtime (the engagement sales decks build their slides after fetching spec.json)
  // have no .pp-slide yet when this script runs: wait for the slides to appear, then boot once.
  if (!document.querySelector(".pp-slide")) {
    var tries = 0;
    var t = setInterval(function () {
      if (document.querySelector(".pp-slide") || ++tries > 300) { clearInterval(t); if (document.querySelector(".pp-slide")) setTimeout(boot, 250); }
    }, 100);
    return;
  }
  boot();
  function boot() {
  if (window.__ppEditInit) return; window.__ppEditInit = 1;

  var SALES = document.documentElement.hasAttribute("data-engage");
  var EDITING = window.__PP_EDIT === 1 || /[?&]edit=1/.test(location.search);
  var MODE = window.__PP_EDIT_MODE || (/[?&]mode=sales/.test(location.search) ? "sales" : "") || (SALES ? "sales" : "full");
  var WORDS = MODE === "sales";

  var INLINE = { inline: 1, "inline-block": 1, contents: 1 };
  var TSEL = "h1,h2,h3,h4,h5,h6,p,li,a,button,cite,blockquote,td,th,dt,dd,figcaption,.eyebrow,.lead,.big,.gt,.v,.l,.k,.cd-date";
  function hasText(el) { return !!(el.innerText && el.innerText.trim()); }
  function isLeaf(el) {
    if (!hasText(el)) return false;
    for (var i = 0; i < el.children.length; i++) { var c = el.children[i]; if (hasText(c) && !INLINE[getComputedStyle(c).display]) return false; }
    return true;
  }
  function ancestorLeaf(el, slide) { var p = el.parentElement; while (p && p !== slide) { if (p.matches(TSEL) && isLeaf(p)) return true; p = p.parentElement; } return false; }

  // ── assign deterministic ids: per slide, text leaves ("t") then images ("i") then containers ("b") ──
  var slides = [].slice.call(document.querySelectorAll(".pp-slide"));
  var byId = {};
  slides.forEach(function (s, si) {
    var key = SALES && s.getAttribute("data-sid") ? s.getAttribute("data-sid") : String(si);
    var t = 0;
    [].slice.call(s.querySelectorAll(TSEL)).forEach(function (el) {
      if (!isLeaf(el) || ancestorLeaf(el, s)) return;
      var eid = "t" + key + "." + (t++); el.setAttribute("data-eid", eid); el.classList.add("ppe-box", "ppe-txt"); byId[eid] = el;
    });
    var im = 0;
    [].slice.call(s.querySelectorAll("img")).forEach(function (el) {
      var r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return;
      var eid = "i" + key + "." + (im++); el.setAttribute("data-eid", eid); el.classList.add("ppe-box", "ppe-img"); byId[eid] = el;
    });
    // container "boxes": cards / panels / pills — anything with a visible fill or border, so they can be
    // moved, resized and recoloured (full mode only). Text leaves inside stay individually selectable.
    var bx = 0, sr = s.getBoundingClientRect(), sArea = sr.width * sr.height || 1;
    [].slice.call(s.querySelectorAll("*")).forEach(function (el) {
      if (el.classList.contains("ppe-box")) return;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.display === "contents" || cs.position === "fixed") return;
      var bg = cs.backgroundColor, hasBg = bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
      var hasBorder = (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") || parseFloat(cs.borderTopLeftRadius) > 0;
      if (!hasBg && !hasBorder) return;
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16 || r.width * r.height > sArea * 0.85) return; // skip tiny + near-full-slide backgrounds
      var eid = "b" + key + "." + (bx++); el.setAttribute("data-eid", eid); el.classList.add("ppe-box", "ppe-cont"); byId[eid] = el;
    });
    // "items" ("x"): a person, a card, a bullet, a chip: one of two or more siblings with the same tag and
    // class. The rep can hide one (sales mode) and the row or grid simply closes up; the design is untouched.
    var ix = 0;
    // twins share a tag, the author's classes (never the runtime's ppe-* markers) and, for unclassed
    // wrappers such as a person card, the same shape (child count + first child's class)
    var own = function (el) { return typeof el.className === "string" ? el.className.replace(/\bppe-\S+/g, "").replace(/\s+/g, " ").trim() : ""; };
    var sig = function (el) { var f = el.firstElementChild; return el.tagName + "|" + own(el) + "|" + el.children.length + "|" + (f ? f.tagName + "." + own(f) : ""); };
    [].slice.call(s.querySelectorAll("*")).forEach(function (el) {
      var p = el.parentElement; if (!p || p === s || el.tagName === "STYLE" || el.tagName === "SCRIPT") return;
      if (!own(el) && !el.children.length) return;
      var cs = getComputedStyle(el); if (cs.display === "none" || cs.display === "contents" || INLINE[cs.display] || cs.position === "fixed") return;
      var r = el.getBoundingClientRect(); if (r.width < 36 || r.height < 20) return;
      var mine = sig(el), twins = 0; for (var k = 0; k < p.children.length; k++) { if (sig(p.children[k]) === mine) twins++; }
      if (twins < 2) return;
      if (!hasText(el) && !el.querySelector("img,svg")) return;
      var xid = "x" + key + "." + (ix++); el.setAttribute("data-xid", xid); el.classList.add("ppe-item"); byId[xid] = el;
    });
  });

  // ── saved words keep their inline markup (the gradient phrase in a title, a bold lead): only these
  //    tags survive, with their class, so a saved edit can never bring a font, a colour or a script with it ──
  var OK_TAGS = { SPAN: 1, B: 1, I: 1, EM: 1, STRONG: 1, BR: 1, U: 1, SUP: 1, SUB: 1, SMALL: 1 };
  function sanitize(html) {
    var doc = new DOMParser().parseFromString('<div id="r">' + String(html) + "</div>", "text/html");
    var root = doc.getElementById("r");
    (function walk(n) {
      var c = n.firstChild;
      while (c) {
        var next = c.nextSibling;
        if (c.nodeType === 1) {
          if (!OK_TAGS[c.tagName]) { var first = c.firstChild; while (c.firstChild) n.insertBefore(c.firstChild, c); n.removeChild(c); next = first || next; }
          else { for (var i = c.attributes.length - 1; i >= 0; i--) { if (c.attributes[i].name !== "class") c.removeAttribute(c.attributes[i].name); } walk(c); }
        } else if (c.nodeType !== 3) n.removeChild(c);
        c = next;
      }
    })(root);
    return root.innerHTML;
  }
  // text size as a multiple of the designed size, so it scales with the viewport like the original clamp()
  function baseSize(el) { var keep = el.style.fontSize; el.style.fontSize = ""; var b = parseFloat(getComputedStyle(el).fontSize) || 16; el.style.fontSize = keep; return b; }
  function scaleFont(el, k) { if (k == null || k === 1) { el.style.fontSize = ""; return; } el.style.fontSize = (baseSize(el) * k).toFixed(2) + "px"; }

  // ── apply a saved patch (text + inline styles + move/resize + fill + photo) ──
  function applyEdits(edits) {
    if (!edits) return;
    Object.keys(edits).forEach(function (eid) {
      var el = byId[eid]; if (!el) return; var e = edits[eid] || {};
      if (e.html != null) { var h = sanitize(e.html); if (el.innerHTML !== h) el.innerHTML = h; }
      else if (typeof e.text === "string" && e.text !== el.innerText) el.innerText = e.text;
      if (e.fontScale != null) scaleFont(el, e.fontScale);
      if (e.color != null) { el.style.setProperty("color", e.color, "important"); el.style.setProperty("-webkit-text-fill-color", e.color, "important"); el.style.backgroundImage = "none"; }
      if (e.bg != null) el.style.setProperty("background-color", e.bg, "important");
      if (e.fontSize != null) el.style.fontSize = e.fontSize;
      if (e.fontWeight != null) el.style.fontWeight = e.fontWeight;
      if (e.fontStyle != null) el.style.fontStyle = e.fontStyle;
      if (e.textAlign != null) el.style.textAlign = e.textAlign;
      if (e.fontFamily != null) el.style.fontFamily = e.fontFamily;
      if (e.imgSrc != null && el.tagName === "IMG" && el.getAttribute("src") !== e.imgSrc) el.src = e.imgSrc;
      if (e.hide) el.classList.add("pp-hide"); else if (el.classList.contains("pp-hide")) el.classList.remove("pp-hide");
      if (e.w != null) el.style.width = e.w + "px";
      if (e.h != null) el.style.height = e.h + "px";
      if (e.x != null || e.y != null) { el.style.transform = "translate(" + (e.x || 0) + "px," + (e.y || 0) + "px)"; el.style.position = el.style.position || "relative"; el.style.zIndex = el.style.zIndex || "5"; }
    });
  }
  // a hidden item is gone from the presentation and the exports; in the editor it stays in place, dimmed
  // and dashed, so the rep can bring it back
  var hs = document.createElement("style");
  hs.textContent = EDITING ? ".pp-hide{opacity:.22!important;filter:grayscale(1);outline:2px dashed #f43f5e!important;outline-offset:3px}" : ".pp-hide{display:none!important}";
  document.head.appendChild(hs);
  var EDITS = {};
  function seed(edits) { EDITS = edits || {}; applyEdits(EDITS); window.__ppEditsApplied = 1; try { window.dispatchEvent(new Event("resize")); } catch (e) {} }
  if (window.__PP_EDITS) seed(window.__PP_EDITS);
  else fetch("./edits.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(seed).catch(function () { seed({}); });
  // scaled text follows the viewport: recompute from the designed size whenever the window changes
  var rsT = null;
  addEventListener("resize", function () { clearTimeout(rsT); rsT = setTimeout(function () { Object.keys(EDITS).forEach(function (id) { var e = EDITS[id]; if (e && e.fontScale != null && byId[id]) scaleFont(byId[id], e.fontScale); }); }, 80); });

  // ── editing only past here ──
  if (!EDITING) return;
  document.documentElement.classList.add("pp-editing");
  if (WORDS) document.documentElement.classList.add("pp-editing-words");

  // neutral sample palette (the company brand palette was removed)
  var BRAND = ["#0f172a", "#475569", "#3b82f6", "#8b5cf6", "#f8fafc", "#14b8a6", "#f43f5e", "#ffffff"];
  var FONTS = [["Inter", "Inter,system-ui,sans-serif"], ["System UI", "system-ui,sans-serif"], ["JetBrains Mono", '"JetBrains Mono",monospace']];
  var st = document.createElement("style");
  st.textContent =
    ".pp-editing .ppe-box{cursor:move}.pp-editing .ppe-txt[contenteditable=true]{cursor:text;outline:none}" +
    ".pp-editing-words .ppe-cont{cursor:default}.pp-editing-words .ppe-txt{cursor:text}.pp-editing-words .ppe-img{cursor:pointer}" +
    ".pp-editing .ppe-box:hover{outline:2px solid rgba(59,130,246,.4);outline-offset:2px}.pp-editing-words .ppe-cont:hover{outline:none}" +
    ".pp-editing .ppe-txt[contenteditable=true]{caret-color:#3b82f6}" +
    ".ppe-ov{position:fixed;z-index:2147482000;border:1.5px solid #3b82f6;pointer-events:none;display:none}" +
    ".ppe-h{position:absolute;width:11px;height:11px;background:#fff;border:1.5px solid #3b82f6;border-radius:2px;pointer-events:auto;cursor:nwse-resize}" +
    ".pp-editing-words .ppe-h{display:none}" +
    ".ppe-h.tl{left:-6px;top:-6px}.ppe-h.tr{right:-6px;top:-6px;cursor:nesw-resize}.ppe-h.bl{left:-6px;bottom:-6px;cursor:nesw-resize}.ppe-h.br{right:-6px;bottom:-6px}" +
    ".ppe-bar{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:6px;padding:6px;border-radius:12px;background:#fff;box-shadow:0 10px 34px rgba(15,23,42,.28);border:1px solid #e2e8f0;font:500 13px Inter,system-ui,sans-serif;flex-wrap:wrap;max-width:96vw;color:#0f172a}" +
    ".ppe-bar button,.ppe-bar select{border:1px solid #e2e8f0;background:#fff;border-radius:8px;height:30px;color:#0f172a;cursor:pointer;font:inherit;padding:0 8px;white-space:nowrap}" +
    ".ppe-bar button:hover{border-color:#bfdbfe;background:#eff6ff}.ppe-bar button.on{background:#dbeafe;border-color:#3b82f6;color:#1d4ed8}" +
    ".ppe-bar button.ppe-pri{background:linear-gradient(135deg,#8b5cf6,#3b82f6,#3b82f6);color:#fff;border:0;font-weight:600}.ppe-bar button.ppe-pri:hover{filter:brightness(1.06)}" +
    ".ppe-ic{width:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-weight:700}" +
    ".ppe-lab{font:600 10px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:0 2px}" +
    ".ppe-hint{font:500 11px/1.2 Inter,system-ui,sans-serif;color:#64748b;padding:0 4px;max-width:220px}" +
    ".ppe-sw{display:flex;gap:3px;align-items:center}.ppe-sw i{width:18px;height:18px;border-radius:5px;cursor:pointer;border:1px solid rgba(15,23,42,.15);display:inline-block}.ppe-sw i:hover{transform:scale(1.12)}" +
    ".ppe-div{width:1px;height:20px;background:#e2e8f0;margin:0 2px}.ppe-size{display:flex;align-items:center;gap:2px}.ppe-size b{min-width:40px;text-align:center;font-variant-numeric:tabular-nums}" +
    ".ppe-size.nope b{color:#f43f5e;animation:ppeShake .45s}@keyframes ppeShake{0%,100%{transform:none}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}" +
    ".pp-editing-words .ppe-hov{outline:2px dashed rgba(59,130,246,.55);outline-offset:3px}" +
    ".ppe-hide{position:fixed;z-index:2147483000;display:none;align-items:center;gap:5px;border:0;border-radius:999px;background:#0f172a;color:#fff;font:600 11px/1 Inter,system-ui,sans-serif;padding:6px 10px;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,.35)}" +
    ".ppe-hide.off{background:#f43f5e}.ppe-hide:hover{filter:brightness(1.15)}";
  document.head.appendChild(st);

  var ov = document.createElement("div"); ov.className = "ppe-ov";
  ov.innerHTML = '<span class="ppe-h tl" data-h="tl"></span><span class="ppe-h tr" data-h="tr"></span><span class="ppe-h bl" data-h="bl"></span><span class="ppe-h br" data-h="br"></span>';
  document.body.appendChild(ov);
  var bar = document.createElement("div"); bar.className = "ppe-bar"; bar.style.display = "none";
  bar.addEventListener("mousedown", function (e) { if (!e.target.closest("select")) e.preventDefault(); });
  document.body.appendChild(bar);
  var picker = document.createElement("input"); picker.type = "color"; picker.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(picker);

  var sel = null, pickTarget = "color";
  function post() { try { parent.postMessage({ type: "ppEdits", edits: EDITS }, "*"); } catch (e) {} }
  function rec(k, v) { if (!sel) return; var id = sel.getAttribute("data-eid"); (EDITS[id] = EDITS[id] || {})[k] = v; post(); }
  function unrec(k) { if (!sel) return; var id = sel.getAttribute("data-eid"); if (EDITS[id]) { delete EDITS[id][k]; if (!Object.keys(EDITS[id]).length) delete EDITS[id]; } post(); }
  // the words of an element: plain text, plus its inline markup when it has any (the gradient phrase)
  function recText(t) {
    var id = t.getAttribute("data-eid"), p = (EDITS[id] = EDITS[id] || {});
    p.text = t.innerText;
    if (t.children.length) p.html = sanitize(t.innerHTML); else delete p.html;
    post();
  }
  function px(el) { return Math.round(parseFloat(getComputedStyle(el).fontSize)) || 16; }
  function num(v) { return Math.round(parseFloat(v) || 0); }
  function scaleOf(el) { var e = EDITS[el.getAttribute("data-eid")]; return e && e.fontScale != null ? e.fontScale : 1; }

  // ── does this text still fit its slide at the current size? (the slide's content block must fit one
  //    screen unscaled, the element must stay inside the slide, and nothing may clip it) ──
  function fits(el) {
    var s = el.closest(".pp-slide"); if (!s) return true;
    var sr = s.getBoundingClientRect();
    var inner = s.querySelector(":scope > .pp-inner");
    if (inner) {
      var tf = inner.style.transform, th = inner.style.height;
      inner.style.transform = "none"; inner.style.height = "auto";
      var cs = getComputedStyle(s);
      var avail = innerHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      var ok = inner.scrollHeight <= avail + 2 && inner.scrollWidth <= inner.clientWidth + 2;
      inner.style.transform = tf; inner.style.height = th;
      if (!ok) return false;
    }
    var r = el.getBoundingClientRect();
    if (r.right > sr.right - 4 || r.bottom > sr.bottom - 4 || r.left < sr.left) return false;
    if (el.scrollWidth > el.clientWidth + 2) return false;
    var p = el.parentElement;
    while (p && p !== s) {
      var pc = getComputedStyle(p);
      if (/hidden|clip/.test(pc.overflow + pc.overflowX + pc.overflowY) && (p.scrollHeight > p.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2)) return false;
      p = p.parentElement;
    }
    return true;
  }
  function refit() { try { window.dispatchEvent(new Event("resize")); } catch (e) {} }

  function buildBar() {
    var isTxt = sel && sel.classList.contains("ppe-txt");
    var isImg = sel && sel.classList.contains("ppe-img");
    if (WORDS) {
      if (isTxt) {
        bar.innerHTML =
          '<span class="ppe-lab">Size</span><span class="ppe-size"><button data-a="dec" class="ppe-ic" title="Smaller">&#8722;</button><b class="ppe-px">100%</b><button data-a="inc" class="ppe-ic" title="Larger">+</button></span>' +
          '<span class="ppe-div"></span><span class="ppe-hint">Type to change the words. Click away or press Esc when you are done.</span>';
      } else if (isImg) {
        var cover = getComputedStyle(sel).objectFit === "cover";
        bar.innerHTML =
          '<button data-a="replace" class="ppe-pri">Replace photo</button>' + (cover ? '<button data-a="reframe">Reframe</button>' : "") +
          '<span class="ppe-hint">' + (cover ? "Drop in any photo, then move and zoom it inside the frame." : "Drop in a new image file.") + "</span>";
      } else bar.innerHTML = "";
      return;
    }
    var sw = function (which) { return BRAND.map(function (c) { return '<i data-sw="' + which + '" data-c="' + c + '" style="background:' + c + '"></i>'; }).join("") + '<i data-sw="' + which + '" data-c="custom" title="More" style="background:conic-gradient(from 0deg,#f43f5e,#8b5cf6,#3b82f6,#14b8a6,#f43f5e)"></i>'; };
    var fo = FONTS.map(function (f) { return '<option value="' + f[1] + '">' + f[0] + "</option>"; }).join("");
    var txtCtl = isTxt ? (
      '<span class="ppe-div"></span><select class="ppe-font" title="Font">' + fo + "</select>" +
      '<span class="ppe-size"><button data-a="dec" class="ppe-ic" title="Smaller">&#8722;</button><b class="ppe-px">16</b><button data-a="inc" class="ppe-ic" title="Larger">+</button></span>' +
      '<span class="ppe-div"></span><button data-a="bold" class="ppe-ic" title="Bold" style="font-weight:800">B</button><button data-a="italic" class="ppe-ic" title="Italic" style="font-style:italic;font-family:Georgia,serif">I</button>' +
      '<span class="ppe-div"></span><button data-a="left" class="ppe-ic" title="Left">&#8676;</button><button data-a="center" class="ppe-ic" title="Centre">&#8596;</button><button data-a="right" class="ppe-ic" title="Right">&#8677;</button>'
    ) : "";
    var imgCtl = isImg ? '<span class="ppe-div"></span><button data-a="replace" class="ppe-pri">Replace image</button>' + (getComputedStyle(sel).objectFit === "cover" ? '<button data-a="reframe">Reframe</button>' : "") : "";
    bar.innerHTML =
      (isTxt ? '<span class="ppe-lab">Text</span><div class="ppe-sw" data-role="color">' + sw("color") + "</div>" : "") +
      '<span class="ppe-lab">Fill</span><div class="ppe-sw" data-role="bg">' + sw("bg") + '<button data-a="nofill" class="ppe-ic" title="No fill">&#8709;</button></div>' +
      txtCtl + imgCtl;
    var fontEl = bar.querySelector(".ppe-font"); if (fontEl) fontEl.addEventListener("change", function (e) { sel.style.fontFamily = e.target.value; rec("fontFamily", e.target.value); });
  }
  function setColor(which, c) {
    if (which === "bg") { if (c === "none") { sel.style.removeProperty("background-color"); rec("bg", "transparent"); } else { sel.style.setProperty("background-color", c, "important"); rec("bg", c); } }
    else { sel.style.setProperty("color", c, "important"); sel.style.setProperty("-webkit-text-fill-color", c, "important"); sel.style.backgroundImage = "none"; rec("color", c); }
  }
  // ask the GTM app for a new photo (it opens the Replace / Reframe dialog and answers with ppSetImage)
  function askImage(reframe) {
    if (!sel) return;
    var r = sel.getBoundingClientRect();
    try { parent.postMessage({ type: "ppImage", eid: sel.getAttribute("data-eid"), src: sel.currentSrc || sel.src, w: Math.round(r.width), h: Math.round(r.height), fit: getComputedStyle(sel).objectFit, reframe: !!reframe }, "*"); } catch (e) {}
  }
  bar.addEventListener("click", function (e) {
    if (!sel) return;
    var s = e.target.closest("i[data-sw]");
    if (s) { var which = s.getAttribute("data-sw"), c = s.getAttribute("data-c"); if (c === "custom") { pickTarget = which; picker.value = which === "bg" ? "#f8fafc" : "#3b82f6"; picker.click(); } else setColor(which, c); return; }
    var b = e.target.closest("button[data-a]"); if (!b) return;
    var a = b.getAttribute("data-a");
    if (a === "replace") askImage(false);
    else if (a === "reframe") askImage(true);
    else if (a === "nofill") setColor("bg", "none");
    else if (WORDS && (a === "inc" || a === "dec")) {
      // steps of 10% of the designed size, between 60% and 160%, and never past what fits the slide
      var k = scaleOf(sel), k2 = Math.round((k + (a === "inc" ? 0.1 : -0.1)) * 100) / 100;
      if (k2 < 0.6 || k2 > 1.6) return;
      scaleFont(sel, k2);
      if (a === "inc" && !fits(sel)) {
        scaleFont(sel, k); var sz = bar.querySelector(".ppe-size"); if (sz) { sz.classList.add("nope"); setTimeout(function () { sz.classList.remove("nope"); }, 500); }
        var hint = bar.querySelector(".ppe-hint"); if (hint) hint.textContent = "That is as large as this text can go without breaking the slide.";
      } else {
        if (k2 === 1) unrec("fontScale"); else rec("fontScale", k2);
      }
      refit(); syncBar(); setTimeout(placeOverlay, 60);
    }
    else if (a === "inc" || a === "dec") { var n = Math.max(8, px(sel) + (a === "inc" ? 2 : -2)); sel.style.fontSize = n + "px"; rec("fontSize", n + "px"); syncBar(); }
    else if (a === "bold") { var on = (parseInt(getComputedStyle(sel).fontWeight) || 400) >= 600; var w = on ? "400" : "700"; sel.style.fontWeight = w; rec("fontWeight", w); syncBar(); }
    else if (a === "italic") { var v = getComputedStyle(sel).fontStyle === "italic" ? "normal" : "italic"; sel.style.fontStyle = v; rec("fontStyle", v); syncBar(); }
    else if (a === "left" || a === "center" || a === "right") { sel.style.textAlign = a; rec("textAlign", a); syncBar(); }
  });
  picker.addEventListener("input", function () { if (sel) setColor(pickTarget, picker.value); });

  function syncBar() {
    if (!sel || !sel.classList.contains("ppe-txt")) return;
    var cs = getComputedStyle(sel); var pe = bar.querySelector(".ppe-px"); if (pe) pe.textContent = WORDS ? Math.round(scaleOf(sel) * 100) + "%" : px(sel);
    var bb = bar.querySelector('button[data-a="bold"]'); if (bb) bb.classList.toggle("on", (parseInt(cs.fontWeight) || 400) >= 600);
    var ib = bar.querySelector('button[data-a="italic"]'); if (ib) ib.classList.toggle("on", cs.fontStyle === "italic");
    ["left", "center", "right"].forEach(function (a) { var x = bar.querySelector('button[data-a="' + a + '"]'); if (x) x.classList.toggle("on", cs.textAlign === a); });
  }
  function placeOverlay() {
    if (!sel) { ov.style.display = "none"; bar.style.display = "none"; return; }
    var r = sel.getBoundingClientRect();
    ov.style.display = "block"; ov.style.left = r.left + "px"; ov.style.top = r.top + "px"; ov.style.width = r.width + "px"; ov.style.height = r.height + "px";
    var bw = bar.offsetWidth || 360, bh = bar.offsetHeight || 44, top = r.top - bh - 12; if (top < 8) top = r.bottom + 12;
    bar.style.display = "flex"; bar.style.top = top + "px"; bar.style.left = Math.min(Math.max(8, r.left), innerWidth - bw - 8) + "px";
  }
  function select(el) {
    if (sel && sel !== el) { sel.classList.remove("ppe-sel"); sel.contentEditable = "false"; }
    sel = el; el.classList.add("ppe-sel"); buildBar(); syncBar(); placeOverlay();
  }
  function deselect() { if (!sel) return; sel.classList.remove("ppe-sel"); sel.contentEditable = "false"; sel = null; ov.style.display = "none"; bar.style.display = "none"; }
  function caretAt(x, y) {
    try { var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null; if (r) { var s = getSelection(); s.removeAllRanges(); s.addRange(r); } } catch (e) {}
  }
  function startText(t, x, y) { select(t); t.contentEditable = "true"; t.focus(); if (x != null) caretAt(x, y); }

  // click select (sales mode: click text = edit it right away) / dblclick edit-text (full mode)
  document.addEventListener("click", function (e) {
    if (e.target.closest(".ppe-bar") || e.target.closest(".ppe-ov")) return;
    var t = e.target.closest(WORDS ? ".ppe-txt,.ppe-img" : ".ppe-box");
    if (!t) { deselect(); return; }
    e.preventDefault(); e.stopPropagation();
    if (WORDS && t.classList.contains("ppe-txt")) { if (t.contentEditable !== "true") startText(t, e.clientX, e.clientY); else if (t !== sel) select(t); return; }
    if (t !== sel) select(t);
  }, true);
  document.addEventListener("dblclick", function (e) {
    var t = e.target.closest(".ppe-txt"); if (!t) return; e.preventDefault(); e.stopPropagation();
    if (t.contentEditable === "true") return;
    startText(t);
  }, true);
  document.addEventListener("input", function (e) {
    var t = e.target.closest(".ppe-txt"); if (!t || t.contentEditable !== "true") return;
    recText(t); placeOverlay();
  }, true);
  // pasted text comes in as plain words, never as someone else's formatting
  document.addEventListener("paste", function (e) {
    var t = e.target.closest && e.target.closest(".ppe-txt"); if (!t || t.contentEditable !== "true") return;
    e.preventDefault(); e.stopPropagation();
    var txt = ((e.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\s*\r?\n\s*/g, " ");
    document.execCommand("insertText", false, txt);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (sel && sel.contentEditable === "true") {
      e.stopPropagation();
      if (e.key === "Escape") { sel.blur(); deselect(); }
      else if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); }
    }
    else if (e.key === "Escape") deselect();
  }, true);

  // drag to MOVE (mousedown on the selected box body) and RESIZE (mousedown on a handle): full mode only
  var drag = null;
  document.addEventListener("mousedown", function (e) {
    if (WORDS) { if (e.target.closest(".ppe-img")) e.preventDefault(); return; }
    var h = e.target.closest(".ppe-h");
    if (h && sel) { e.preventDefault(); drag = { mode: "resize", corner: h.getAttribute("data-h"), sx: e.clientX, sy: e.clientY, w0: sel.offsetWidth, h0: sel.offsetHeight, x0: num((EDITS[sel.getAttribute("data-eid")] || {}).x), y0: num((EDITS[sel.getAttribute("data-eid")] || {}).y) }; return; }
    var box = e.target.closest(".ppe-box");
    if (box && box.contentEditable !== "true" && !e.target.closest(".ppe-bar")) {
      if (box !== sel) select(box);
      e.preventDefault();
      var cur = EDITS[box.getAttribute("data-eid")] || {};
      drag = { mode: "move", sx: e.clientX, sy: e.clientY, x0: num(cur.x), y0: num(cur.y) };
    }
  }, true);
  document.addEventListener("mousemove", function (e) {
    if (!drag || !sel) return; e.preventDefault();
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.mode === "move") {
      var x = drag.x0 + dx, y = drag.y0 + dy;
      sel.style.position = sel.style.position || "relative"; sel.style.zIndex = "5"; sel.style.transform = "translate(" + x + "px," + y + "px)";
    } else {
      var c = drag.corner, w = drag.w0, h = drag.h0, x = drag.x0, y = drag.y0;
      if (c.indexOf("r") >= 0) w = drag.w0 + dx; if (c.indexOf("l") >= 0) { w = drag.w0 - dx; x = drag.x0 + dx; }
      if (c.indexOf("b") >= 0) h = drag.h0 + dy; if (c.indexOf("t") >= 0) { h = drag.h0 - dy; y = drag.y0 + dy; }
      w = Math.max(24, w); h = Math.max(16, h);
      sel.style.width = w + "px"; sel.style.height = h + "px";
      sel.style.position = sel.style.position || "relative"; sel.style.transform = "translate(" + x + "px," + y + "px)"; sel.dataset._w = w; sel.dataset._h = h; sel.dataset._x = x; sel.dataset._y = y;
    }
    placeOverlay();
  }, true);
  document.addEventListener("mouseup", function () {
    if (!drag || !sel) { drag = null; return; }
    var id = sel.getAttribute("data-eid"), p = (EDITS[id] = EDITS[id] || {});
    var m = new DOMMatrixReadOnly(getComputedStyle(sel).transform);
    p.x = Math.round(m.m41); p.y = Math.round(m.m42);
    if (drag.mode === "resize") { p.w = Math.round(sel.offsetWidth); p.h = Math.round(sel.offsetHeight); }
    post(); drag = null;
  }, true);

  ["scroll", "resize"].forEach(function (ev) { addEventListener(ev, placeOverlay, true); });

  // sales mode: hover a person, a card, a bullet or a chip and a Hide chip appears at its corner. Hidden
  // items leave the presentation and the exports (the row closes up); in the editor they stay, dimmed,
  // with a Show chip to bring them back.
  if (WORDS) {
    var chip = document.createElement("button"); chip.type = "button"; chip.className = "ppe-hide"; document.body.appendChild(chip);
    var hov = null;
    function placeChip() {
      if (!hov || !document.contains(hov)) { hov = null; chip.style.display = "none"; return; }
      var r = hov.getBoundingClientRect(), off = hov.classList.contains("pp-hide");
      chip.textContent = off ? "Show" : "Hide"; chip.className = "ppe-hide" + (off ? " off" : ""); chip.style.display = "inline-flex";
      chip.style.left = Math.max(4, Math.min(innerWidth - chip.offsetWidth - 4, r.right - chip.offsetWidth - 6)) + "px";
      chip.style.top = Math.max(4, r.top + 6) + "px";
    }
    document.addEventListener("mousemove", function (e) {
      if (e.target.closest(".ppe-hide,.ppe-bar")) return;
      var it = e.target.closest(".ppe-item");
      if (it !== hov) { if (hov) hov.classList.remove("ppe-hov"); hov = it; if (hov) hov.classList.add("ppe-hov"); placeChip(); }
    }, true);
    chip.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
    chip.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); if (!hov) return;
      var id = hov.getAttribute("data-xid"), off = hov.classList.contains("pp-hide");
      if (off) { hov.classList.remove("pp-hide"); if (EDITS[id]) { delete EDITS[id].hide; if (!Object.keys(EDITS[id]).length) delete EDITS[id]; } }
      else { hov.classList.add("pp-hide"); (EDITS[id] = EDITS[id] || {}).hide = true; }
      post(); refit(); placeChip(); setTimeout(placeOverlay, 60);
    });
    ["scroll", "resize"].forEach(function (ev) { addEventListener(ev, placeChip, true); });
  }
  addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type === "ppSeed") { EDITS = d.edits || {}; applyEdits(EDITS); refit(); }
    else if (d.type === "ppGoto" && d.sid) {
      // the app asks for a slide (e.g. the one it just added): scroll there once the deck has settled
      setTimeout(function () { var s = document.querySelector('.pp-slide[data-sid="' + String(d.sid).replace(/[^a-z0-9~-]/gi, "") + '"]'); if (s) s.scrollIntoView({ behavior: "instant", block: "start" }); }, 600);
    }
    else if (d.type === "ppSetImage" && d.eid && byId[d.eid]) {
      var im = byId[d.eid]; im.src = d.src;
      (EDITS[d.eid] = EDITS[d.eid] || {}).imgSrc = d.src; post();
      if (sel === im) setTimeout(placeOverlay, 120);
    }
  });
  try { parent.postMessage({ type: "ppEditReady", mode: MODE }, "*"); } catch (e) {}
  }
})();
