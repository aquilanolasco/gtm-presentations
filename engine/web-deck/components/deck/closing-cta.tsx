"use client";

/* Fixed closing page for every deck's export (PDF/PPTX) and live view. Design "B":
   135deg gradient, white logo top-left, a one-line headline + two-line paragraph,
   then a signature built from the deck CREATOR's own details, sized to the photo's height
   (name/title top-aligned to the photo top, "Book a call" bottom-aligned near the photo bottom),
   the website pinned bottom-left, and the product screens bleeding off the bottom-right.
   Authored in vw/vh so it reproduces the approved 1600x900 export exactly and scales on a 16:9 slide.
   Email always uses the person's company-domain handle. Pass a different creator per deck. */

export type DeckCreator = {
  name: string;
  title: string;
  email: string;
  phone?: string;
  avatar: string; // absolute or /content-media/... URL
  booking?: { label?: string; href: string };
};

const HOST = `https://${process.env.NEXT_PUBLIC_APP_DOMAIN ?? "app.example.com"}`;
// sample copy (original content removed)
const DEFAULT_HEADLINE = "Want to see what this looks like in practice?";
const DEFAULT_BODY =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.";
const DEMO_FALLBACK = "https://www.example.com/request-a-demo";
const COMPANY_EMAIL_DOMAIN = "example.com";

export function ClosingCTA({
  creator,
  headline = DEFAULT_HEADLINE,
  body = DEFAULT_BODY,
}: {
  creator: DeckCreator;
  headline?: string;
  body?: string;
}) {
  const avatar = creator.avatar.startsWith("http") ? creator.avatar : HOST + creator.avatar;
  // everyone's shown email is normalised to the one company domain (same handle on any alias domain)
  const email = creator.email.replace(/@[^@]+$/, `@${COMPANY_EMAIL_DOMAIN}`);
  const bookHref = creator.booking?.href ?? DEMO_FALLBACK;
  return (
    <section className="pp-slide pp-hide-logo cta-slide" id="close" data-sid="close">
      <div className="cta-grad" aria-hidden="true" />
      <img className="cta-logo" src={`${HOST}/brand/logo-placeholder.svg`} alt="Acme" />
      <h2 className="cta-h r">{headline}</h2>
      <p className="cta-p r">{body}</p>
      <div className="cta-sig r">
        <img className="cta-avatar" src={avatar} alt={creator.name} />
        <div className="cta-meta">
          <div className="cta-topgrp">
            <div className="cta-name">{creator.name}, {creator.title}</div>
            <a className="cta-email" href={`mailto:${email}`}>{email}</a>
            {creator.phone ? <a className="cta-tel" href={`tel:${creator.phone.replace(/[^+\d]/g, "")}`}>{creator.phone}</a> : null}
          </div>
          <a className="cta-btn" href={bookHref} target="_blank" rel="noopener noreferrer">Book a call</a>
        </div>
      </div>
      <a className="cta-site" href="https://www.example.com" target="_blank" rel="noopener noreferrer">www.example.com</a>

      <div className="cta-screens" aria-hidden="true">
        {/* product screen mockups (desktop + phone): placeholders, original screenshots removed */}
        <img className="cta-desk" src={`${HOST}/brand/logo-placeholder.svg`} alt="" />
        <img className="cta-phone" src={`${HOST}/brand/logo-placeholder.svg`} alt="" />
      </div>

      <style>{`
        /* In the live deck the left sidebar nav (~13vw) overlays this slide, so the content is
           inset to clear it. The PDF/PPTX export hides the sidebar and uses the generated closing
           page (closing-<key>.png) instead, so that keeps the tighter approved inset. */
        .cta-slide{position:relative;overflow:hidden;color:#fff;padding:6.44vh 5.875vw 6.44vh 15vw;display:block!important;align-items:initial;justify-content:initial;text-align:left}
        .cta-grad{position:absolute;inset:0;background:linear-gradient(135deg,#8b5cf6 0%,#8b5cf6 50%,#3b82f6 100%);z-index:0}
        .cta-logo{position:relative;z-index:5;height:8.625vw;width:auto;display:block}
        .cta-slide .cta-h{position:relative;z-index:5;font-family:var(--disp);font-weight:400;letter-spacing:-.02em;white-space:nowrap;font-size:2.6vw;line-height:1.05;margin-top:10vh;color:#fff}
        .cta-p{position:relative;z-index:5;font-size:1.12vw;line-height:1.5;color:rgba(255,255,255,.92);max-width:65.6vw;margin-top:1.78vh}
        .cta-sig{position:relative;z-index:5;display:flex;align-items:flex-start;gap:1.625vw;margin-top:2.89vh}
        .cta-avatar{width:11.75vw;height:11.75vw;border-radius:50%;object-fit:cover;border:.25vw solid rgba(255,255,255,.92);flex:0 0 auto}
        .cta-meta{height:10.25vw;display:flex;flex-direction:column;justify-content:space-between}
        .cta-topgrp{display:flex;flex-direction:column;gap:.3vw;margin-top:1.375vw}
        /* a long "Name, Title" wraps to a second line instead of running under the white browser mockup */
        .cta-name{font-weight:600;font-size:1.22vw;line-height:1.1;color:#fff;max-width:26vw;white-space:normal;text-wrap:balance}
        .cta-email,.cta-tel{display:block;width:fit-content;font-size:1.02vw;color:#fff;text-decoration:none}
        .cta-email:hover,.cta-tel:hover,.cta-site:hover{text-decoration:underline}
        .cta-btn{display:block;width:fit-content;background:#fff;color:#4023b0;font-weight:600;font-size:1.04vw;border-radius:999px;text-decoration:none;white-space:nowrap;padding:.75vw 1.75vw;box-shadow:0 .9vw 1.9vw -.75vw rgba(0,0,0,.45)}
        .cta-btn:hover{color:#2d1580}
        .cta-site{position:absolute;left:15vw;bottom:4.67vh;z-index:5;font-size:1.02vw;color:#fff;text-decoration:none}
        .cta-screens{position:absolute;inset:0;z-index:1;pointer-events:none}
        .cta-desk{position:absolute;width:67.5vw;top:52.2vh;right:-9.375vw;transform:rotate(7deg);filter:drop-shadow(0 2vw 4vw rgba(10,6,40,.5));display:block}
        .cta-phone{position:absolute;width:20.625vw;top:55.6vh;right:47.5vw;transform:rotate(-5deg);filter:drop-shadow(0 1.6vw 3vw rgba(10,6,40,.55))}
        @media(max-width:980px){.cta-screens{display:none}.cta-h{white-space:normal}}
      `}</style>
    </section>
  );
}
