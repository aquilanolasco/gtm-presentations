import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on("pageerror",e=>errs.push(String(e.message)));
await p.goto("http://localhost:3000/v2",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
const y0=await p.evaluate(()=>window.scrollY);
// click the 5th left-nav item
await p.evaluate(()=>{const els=document.querySelectorAll('.pp-sidenav__item');els[4]&&els[4].click();});
await p.waitForTimeout(1400);
const y1=await p.evaluate(()=>window.scrollY);
// click a right-rail dot (index 1)
await p.evaluate(()=>{const d=document.querySelectorAll('.pp-rail button');d[1]&&d[1].click();});
await p.waitForTimeout(1400);
const y2=await p.evaluate(()=>window.scrollY);
console.log("scrollY: start",y0,"after sidenav[4]",y1,"after rail[1]",y2,"| nav works:",(y1!==y0));
console.log("errors:",errs.length?errs.slice(0,5):"none");
// capture the promise (container-scroll) slide at a scrolled position
await p.evaluate(()=>document.getElementById('promise').scrollIntoView());
await p.waitForTimeout(1200);
await p.screenshot({path:"qa/shots/v2-promise.png"});
await b.close();
