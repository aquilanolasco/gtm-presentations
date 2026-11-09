import { chromium } from "playwright";
import fs from "node:fs"; import path from "node:path";
function arg(n,d){const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];}
const URL=arg("url","http://localhost:3000"); const OUT=path.resolve(arg("outdir","qa/shots/scroll"));
const STEPS=parseInt(arg("steps","12")); const W=parseInt(arg("w","1440")); const H=parseInt(arg("h","900"));
fs.mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:W,height:H}});
await p.goto(URL,{waitUntil:"networkidle"});
await p.waitForTimeout(1200);
const total=await p.evaluate(()=>document.body.scrollHeight);
for(let i=0;i<=STEPS;i++){
  const y=Math.round((total-H)*(i/STEPS));
  await p.evaluate((yy)=>window.scrollTo({top:yy,behavior:"instant"}),y);
  await p.waitForTimeout(1200);
  await p.screenshot({path:path.join(OUT,`s${String(i).padStart(2,"0")}.png`)});
}
await b.close();
console.log("scroll shots ->",OUT,"| pageHeight",total);
