// Operator-only real-session benchmark. Never saves cookies, credentials or response bodies.
import { chromium, request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const origin=process.argv[4]??process.env.SRO_BENCH_URL??'http://localhost:3100';
const label=process.argv[2]??'before-dev';
const role=process.argv[3]??'admin';
const vault=path.join(process.env.USERPROFILE,'.codex','secrets','sro-clinic','jyigxpjvygvtvcypujel');
const person=role==='admin'?JSON.parse(await readFile(path.join(vault,'phase2b-demo-admin.json'),'utf8')):JSON.parse(await readFile(path.join(vault,'phase2c-demo-accounts.json'),'utf8')).accounts.find(a=>a.role===role);
const api=await request.newContext({baseURL:origin});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={label,role,origin,navigations:[],api:[],documents:0};
let stage='login',status;
try{
  const login=await api.post('/api/auth/login',{headers:{Origin:process.env.SRO_BENCH_LOGIN_ORIGIN??origin},data:{email:person.email,password:person.password}});
  status=login.status();if(!login.ok())throw new Error('Private benchmark login failed');
  stage='initial workspace';
  const ctx=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000}});
  await ctx.addCookies((await api.storageState()).cookies);
  const page=await ctx.newPage();
  page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())report.documents++;});
  page.on('requestfinished',async r=>{if(new URL(r.url()).pathname==='/api/clinic')report.api.push({durationMs:Math.round(r.timing().responseEnd),operation:new URL(r.url()).searchParams.get('operation')??'snapshot'});});
  await page.goto(`/${role}`);await page.locator('aside.sidebar').waitFor();
  await page.evaluate(()=>{
    window.__shell={sidebar:document.querySelector('aside.sidebar'),header:document.querySelector('.topbar'),loaderSeen:false,shellMissing:false};
    new MutationObserver(()=>{const s=window.__shell;if(document.body.innerText.includes('Loading your clinic'))s.loaderSeen=true;if(!document.querySelector('aside.sidebar')||!document.querySelector('.topbar'))s.shellMissing=true;}).observe(document.body,{subtree:true,childList:true});
  });
  const routes=role==='admin'?['appointments','patients','doctors','branches','specializations','schedules','records','fees','dashboard']:role==='doctor'?['appointments','patients','schedules','records','prescriptions','dashboard']:['appointments','doctors','records','prescriptions','dashboard'];
  for(let pass=0;pass<2;pass++)for(const section of routes){
    stage=`navigation ${section}`;
    const href=`/${role}${section==='dashboard'?'':`/${section}`}`;
    const before=report.api.length;
    await page.evaluate(()=>{window.__shell.loaderSeen=false;window.__shell.shellMissing=false;window.__navStart=performance.now();});
    await page.locator(`aside.sidebar a.nav-link[href="${href}"]`).click();
    await page.waitForFunction(href=>document.querySelector(`aside.sidebar a.nav-link[href="${href}"][aria-current="page"]`)&&document.querySelector('#main-content h1'),href);
    const result=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const s=window.__shell;return{ms:Math.round(performance.now()-window.__navStart),loaderSeen:s.loaderSeen,shellMissing:s.shellMissing,sameSidebar:s.sidebar===document.querySelector('aside.sidebar'),sameHeader:s.header===document.querySelector('.topbar')};});
    report.navigations.push({section,pass:pass===0?'first':'warm',...result,snapshotRequests:report.api.length-before});
  }
  report.completedAt=new Date().toISOString();
  await mkdir('artifacts/web-performance',{recursive:true});
  await writeFile(`artifacts/web-performance/${label}-${role}.json`,JSON.stringify(report,null,2)+'\n');
  const warm=report.navigations.filter(n=>n.pass==='warm').map(n=>n.ms).sort((a,b)=>a-b);
  console.log(JSON.stringify({label,role,warmMedianMs:warm[Math.floor(warm.length/2)],warmMaxMs:Math.max(...warm),loaderNavigations:report.navigations.filter(n=>n.loaderSeen).length,sameShell:report.navigations.every(n=>n.sameSidebar&&n.sameHeader),snapshotRequests:report.api.length,documents:report.documents}));
}catch(error){console.error(JSON.stringify({failed:true,label,role,stage,status,errorType:error.name,completed:report.navigations.length}));process.exitCode=1;}finally{await api.dispose();await browser.close();}
