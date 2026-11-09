import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on("pageerror",e=>errs.push(String(e.message)));
await p.goto("http://localhost:3000/v2",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
await p.evaluate(()=>document.getElementById('promise').scrollIntoView());
await p.evaluate(()=>window.scrollBy(0,520)); await p.waitForTimeout(1400);
await p.screenshot({path:"qa/shots/v2-promise2.png"});
console.log("errors:",errs.length?errs.slice(0,5):"none");
await b.close();
