/* ============================================================================
   Engine v2 GSAP choreography  --  self-hosted GSAP + ScrollTrigger + SplitText.
   8 presets matching deck-spec.schema.json `animation` enum. Reduced-motion safe.
   Uses fromTo() with explicit end states so CSS pre-hiding (.anim{opacity:0})
   never traps a reveal at 0. Scroller is the .deck scroll-snap container.
   Expects window.gsap, window.ScrollTrigger and window.SplitText to be loaded
   first. The vendor/ GSAP builds are not included in this export: take them
   from the gsap npm package (node_modules/gsap/dist/) or a pinned CDN copy.
   Without GSAP it falls back to IntersectionObserver nav highlighting only.
   ============================================================================ */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");

  var deck = document.querySelector(".deck");
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var navItems = Array.prototype.slice.call(document.querySelectorAll(".deck-nav__item"));
  var progress = document.querySelector(".deck-nav__progress i");

  function setActive(i) {
    navItems.forEach(function (n, k) { n.classList.toggle("is-active", k === i); });
    if (progress && slides.length > 1) progress.style.width = ((i / (slides.length - 1)) * 100) + "%";
  }

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGSAP = typeof window.gsap !== "undefined";

  navItems.forEach(function (n) {
    n.addEventListener("click", function (e) {
      e.preventDefault();
      var t = document.getElementById(n.getAttribute("data-target"));
      if (t) t.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    });
  });

  if (reduced || !hasGSAP) {
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) setActive(slides.indexOf(en.target)); });
      }, { root: deck, threshold: 0.55 });
      slides.forEach(function (s) { io.observe(s); });
    }
    return;
  }

  var gsap = window.gsap;
  gsap.registerPlugin(window.ScrollTrigger, window.SplitText);
  var ST = window.ScrollTrigger;
  ST.defaults({ scroller: deck });
  var EASE = "power3.out";

  function els(slide, sel) { return Array.prototype.slice.call(slide.querySelectorAll(sel)); }

  function parseMetric(text) {
    var m = String(text).match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
    if (!m) return null;
    var raw = m[2].replace(/,/g, "");
    var decimals = (raw.split(".")[1] || "").length;
    return { prefix: m[1] || "", num: parseFloat(raw), suffix: m[3] || "", decimals: decimals, grouped: m[2].indexOf(",") > -1 };
  }
  function fmt(n, meta) {
    var v = meta.decimals ? n.toFixed(meta.decimals) : Math.round(n).toString();
    if (meta.grouped) {
      var parts = v.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      v = parts.join(".");
    }
    return meta.prefix + v + meta.suffix;
  }
  function countUp(tl, slide) {
    els(slide, ".stat__value").forEach(function (node) {
      var target = node.querySelector(".grad-text") || node;
      var meta = parseMetric(target.textContent);
      if (!meta) return;
      var proxy = { v: 0 };
      target.textContent = fmt(0, meta);
      tl.to(proxy, {
        v: meta.num, duration: 1.1, ease: "power2.out",
        onUpdate: function () { target.textContent = fmt(proxy.v, meta); }
      }, 0.2);
    });
  }

  var UP = { y: 28, opacity: 0 }, DOWN = { y: 0, opacity: 1, duration: 0.7, stagger: 0.09, ease: EASE };

  function buildTimeline(slide) {
    var type = slide.getAttribute("data-anim") || "fade-up";
    var tl = gsap.timeline({ paused: true });
    var anim = els(slide, ".anim");
    var panel = slide.querySelector(".slide-right");
    var head = slide.querySelector(".headline");

    if (type === "none") { gsap.set(anim, { opacity: 1, y: 0 }); return tl; }

    // Split presets pre-hide the headline in JS (CSS can't target JS-made word spans).
    if ((type === "hero-reveal" || type === "split-text") && head) gsap.set(head, { opacity: 0 });
    var rest = anim.filter(function (e) { return e !== head; });

    switch (type) {
      case "hero-reveal": {
        if (head) {
          var split = new window.SplitText(head, { type: "words" });
          tl.set(head, { opacity: 1 }, 0)
            .fromTo(split.words, { yPercent: 120, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: EASE }, 0);
        }
        tl.fromTo(rest, UP, { y: 0, opacity: 1, duration: 0.7, stagger: 0.08, ease: EASE }, 0.2);
        if (panel) tl.fromTo(panel, { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: EASE }, 0.1);
        break;
      }
      case "split-text": {
        if (head) {
          var sp = new window.SplitText(head, { type: "chars,words" });
          tl.set(head, { opacity: 1 }, 0)
            .fromTo(sp.chars, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.012, ease: EASE }, 0);
        }
        tl.fromTo(rest, UP, { y: 0, opacity: 1, duration: 0.6, stagger: 0.08, ease: EASE }, 0.25);
        break;
      }
      case "stat-countup":
        tl.fromTo(anim, UP, { y: 0, opacity: 1, duration: 0.6, stagger: 0.08, ease: EASE });
        countUp(tl, slide);
        break;
      case "stagger-cards":
        tl.fromTo(anim, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.1, ease: EASE });
        break;
      case "parallax-panel":
        tl.fromTo(anim, UP, { y: 0, opacity: 1, duration: 0.6, stagger: 0.08, ease: EASE });
        if (panel) {
          gsap.fromTo(panel.querySelectorAll("img,video"), { yPercent: 6 }, {
            yPercent: -6, ease: "none",
            scrollTrigger: { trigger: slide, scroller: deck, start: "top bottom", end: "bottom top", scrub: true }
          });
        }
        break;
      case "section-wipe":
        tl.fromTo(slide.querySelector(".slide-inner"), { opacity: 0 }, { opacity: 1, duration: 0.4 })
          .fromTo(anim, { xPercent: -6, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.7, stagger: 0.08, ease: EASE }, 0.05);
        break;
      case "fade-up":
      default:
        tl.fromTo(anim, UP, DOWN);
    }
    return tl;
  }

  var timelines = [];
  slides.forEach(function (slide, i) {
    var tl = buildTimeline(slide);
    timelines[i] = tl;
    ST.create({ trigger: slide, start: "top 68%", onEnter: function () { tl.play(); } });
    ST.create({
      trigger: slide, start: "top 55%", end: "bottom 45%",
      onToggle: function (self) { if (self.isActive) setActive(i); }
    });
  });

  setActive(0);
  if (timelines[0]) timelines[0].play();
  ST.refresh();
})();
