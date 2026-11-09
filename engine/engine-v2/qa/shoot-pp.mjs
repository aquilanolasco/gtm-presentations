import { chromium } from "playwright";
import fs from "node:fs"; import path from "node:path";
function arg(n,d){const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];}
const URL=arg("url"); const OUT=path.resolve(arg("outdir")); const W=+arg("w","1440"), H=+arg("h","900");
fs.mkdirSync(OUT,{recursive:true});
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:W,height:H}});
const errs=[]; p.on("pageerror",e=>errs.push(String(e.message))); p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.goto(URL,{waitUntil:"networkidle"}); await p.waitForTimeout(900);
const n=await p.$$eval(".pp-slide",els=>els.length);
for(let i=0;i<n;i++){await p.evaluate(idx=>document.querySelectorAll(".pp-slide")[idx].scrollIntoView({behavior:"instant",block:"start"}),i);await p.waitForTimeout(1300);await p.screenshot({path:path.join(OUT,`s${String(i).padStart(2,"0")}.png`)});}
await b.close(); console.log("slides",n,"errors:",errs.length?errs.slice(0,6):"none");
