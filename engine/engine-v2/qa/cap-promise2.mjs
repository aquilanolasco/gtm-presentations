import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto("http://localhost:3000/v2",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
await p.evaluate(()=>{const el=document.getElementById('promise');window.scrollTo(0, el.offsetTop + el.offsetHeight*0.42);});
await p.waitForTimeout(1500);
await p.screenshot({path:"qa/shots/v2-promise3.png"});
await b.close(); console.log("done");
