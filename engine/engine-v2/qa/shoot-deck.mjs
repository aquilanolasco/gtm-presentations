import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import fs from "node:fs"; import path from "node:path";
function arg(n,d){const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];}
const DECK=path.resolve(arg("deck")); const OUT=path.resolve(arg("outdir","qa/shots/deck"));
const VPS=[{n:"desktop",w:1440,h:900},{n:"phone",w:390,h:844}];
fs.mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
for(const v of VPS){
  const p=await b.newPage({viewport:{width:v.w,height:v.h}});
  await p.goto(pathToFileURL(DECK).href,{waitUntil:"networkidle"});
  const total=await p.evaluate(()=>document.querySelectorAll('.slide').length);
  for(let i=0;i<total;i++){
    await p.evaluate((idx)=>document.querySelectorAll('.slide')[idx].scrollIntoView({behavior:'instant',block:'start'}),i);
    await p.waitForTimeout(1300);
    await p.screenshot({path:path.join(OUT,`${v.n}-${String(i+1).padStart(2,'0')}.png`)});
  }
  await p.close();
}
await b.close();
console.log("done");
