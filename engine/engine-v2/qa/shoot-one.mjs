import { chromium } from "playwright";
import path from "node:path";
function arg(n,d){const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];}
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on("pageerror",e=>errs.push(String(e.message)));
await p.goto(arg("url"),{waitUntil:"networkidle"}); await p.waitForTimeout(2600);
await p.screenshot({path:path.resolve(arg("out"))});
await b.close(); console.log("errors:",errs.length?errs.slice(0,5):"none");
