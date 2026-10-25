// Build the README header and native icon from the approved vector mark.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'gfot-brand-'));
app.setPath('userData',path.join(scratch,'appdata'));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let win;
 try{
  const mark=fs.readFileSync(path.join(root,'desktop/ui/brand-mark.svg'),'utf8');
  fs.writeFileSync(path.join(root,'desktop/ui/brand-mark-dark.svg'),mark.replaceAll('#242624','#F0F2EC'));
  const viewBox=mark.match(/\bviewBox="([^"]+)"/)?.[1];if(!viewBox)throw Error('Brand mark needs a viewBox');
  const geometry=mark.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
  function placeMark(x,y,width,height,prefix){
   let content=geometry;const ids=[...content.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
   for(const id of ids)content=content.replaceAll(`id="${id}"`,`id="${prefix}-${id}"`).replaceAll(`url(#${id})`,`url(#${prefix}-${id})`);
   return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${viewBox}">${content}</svg>`;
  }
  const hero=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" fill="none">
<title>gfot — Switch agents. Keep your task.</title>
<desc>The relay g: a charcoal body and blue finishing stroke. 换个 Agent，继续完成。</desc>
<rect width="1200" height="360" rx="22" fill="#F6F7F3"/>
${placeMark(63,57,127,182,'hero')}
<g font-family="-apple-system,BlinkMacSystemFont,PingFang SC,Helvetica Neue,Arial,sans-serif">
<text x="237" y="145" fill="#242624" font-weight="650" font-size="88" letter-spacing="-5">gfot</text>
<text x="242" y="195" fill="#666E5E" font-size="21" letter-spacing="-.3">Switch agents. Keep your task.</text>
<text x="66" y="306" fill="#58634C" font-size="16">换个 Agent，继续完成。</text>
<text x="1134" y="67" text-anchor="end" fill="#818A75" font-size="10" letter-spacing="1.8">ONE PROJECT / SHARED CONTEXT</text>
<path d="M762 143H1062" stroke="#D6DDCD" stroke-width="2"/>
<path d="M912 143H1062" stroke="#2862F5" stroke-width="2"/>
<circle cx="762" cy="143" r="23" fill="#FFF" stroke="#D9DFD0"/>
<circle cx="912" cy="143" r="23" fill="#FFF" stroke="#D9DFD0"/>
<circle cx="1062" cy="143" r="23" fill="#2862F5"/>
<text x="762" y="149" text-anchor="middle" fill="#59634E" font-size="17">C</text>
<text x="912" y="149" text-anchor="middle" fill="#59634E" font-size="17">W</text>
<text x="1062" y="149" text-anchor="middle" fill="#FFF" font-size="17">O</text>
<text x="762" y="196" text-anchor="middle" fill="#737D67" font-size="12">Codex account</text>
<text x="912" y="196" text-anchor="middle" fill="#737D67" font-size="12">WorkBuddy</text>
<text x="1062" y="196" text-anchor="middle" fill="#737D67" font-size="12">OpenCode</text>
<text x="1134" y="306" text-anchor="end" fill="#818A75" font-size="12">Shared context · Saved progress</text>
</g></svg>\n`;
  fs.writeFileSync(path.join(root,'docs/readme-hero.svg'),hero);
  const icon=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>gfot</title><rect x="12" y="12" width="1000" height="1000" rx="222" fill="#F7F8F5"/><rect x="13" y="13" width="998" height="998" rx="221" fill="none" stroke="#E4E7DF" stroke-width="2"/>${placeMark(286,173,452,647,'app')}</svg>`;
  fs.writeFileSync(path.join(root,'desktop/assets/icon.svg'),icon);
  win=new BrowserWindow({width:1024,height:1024,useContentSize:true,frame:false,show:false,transparent:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.setBackgroundThrottling(false);
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:100%;height:100%;background:transparent}body>svg{display:block;width:100%;height:100%}</style>'+icon));
  const png=(await win.webContents.capturePage()).resize({width:1024,height:1024,quality:'best'}).toPNG();
  const pngPath=path.join(root,'desktop/assets/icon.png');fs.writeFileSync(pngPath,png);
  const set=path.join(scratch,'gfot.iconset');fs.mkdirSync(set);
  for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),pngPath,'--out',path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
  execFileSync('/usr/bin/iconutil',['-c','icns',set,'-o',path.join(root,'desktop/assets/icon.icns')]);
  console.log('Built README header, app SVG, PNG and ICNS from desktop/ui/brand-mark.svg.');
 }catch(error){console.error(error.message);process.exitCode=1;}
 finally{win?.destroy();fs.rmSync(scratch,{recursive:true,force:true});app.quit();}
});
