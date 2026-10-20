// Rebuild every graphic from the same vector mark. Run with Electron on macOS.
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
  const paths=mark.replace(/^[\s\S]*?<title>[\s\S]*?<\/title>/,'').replace(/<\/svg>\s*$/,'');
  const hero=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="340" viewBox="0 0 1200 340" fill="none">
<title>gfot — One project. Keep going.</title>
<desc>gfot's cobalt and cyan identity. 一个项目，接着做下去。</desc>
<rect x="1" y="1" width="1198" height="338" rx="24" fill="#FAFCFF" stroke="#E5ECF4" stroke-width="2"/>
<g transform="translate(76 52) scale(1.2)">${paths}</g>
<text x="275" y="169" fill="#14213D" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="137" letter-spacing="-8">gfot</text>
<text x="280" y="224" fill="#526079" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif" font-size="25" letter-spacing="-.4">One project. Keep going.</text>
<path d="M280 271H432" stroke="#2862F5" stroke-width="3"/>
<path d="M432 271H484" stroke="#22CBE5" stroke-width="3"/>
<text x="1116" y="78" text-anchor="end" fill="#526079" font-family="Arial,Helvetica,sans-serif" font-size="12" letter-spacing="2">PROJECTS / AGENT CONNECTIONS</text>
<text x="1116" y="279" text-anchor="end" fill="#14213D" font-family="-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif" font-size="24">一个项目，接着做下去。</text>
</svg>\n`;
  fs.writeFileSync(path.join(root,'docs/readme-hero.svg'),hero);
  const icon=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="12" y="12" width="1000" height="1000" rx="222" fill="#FAFCFF"/><rect x="13" y="13" width="998" height="998" rx="221" fill="none" stroke="#E6ECF5" stroke-width="2"/><g transform="translate(269 171) scale(3.8)">${paths}</g></svg>`;
  fs.writeFileSync(path.join(root,'desktop/assets/icon.svg'),icon);
  win=new BrowserWindow({width:1024,height:1024,useContentSize:true,frame:false,show:false,transparent:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>'+icon));
  const png=(await win.webContents.capturePage()).resize({width:1024,height:1024,quality:'best'}).toPNG();
  const pngPath=path.join(root,'desktop/assets/icon.png');fs.writeFileSync(pngPath,png);
  const set=path.join(scratch,'gfot.iconset');fs.mkdirSync(set);
  for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),pngPath,'--out',path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
  execFileSync('/usr/bin/iconutil',['-c','icns',set,'-o',path.join(root,'desktop/assets/icon.icns')]);
  console.log('Built README header, app SVG, PNG and ICNS from desktop/ui/brand-mark.svg.');
 }catch(error){console.error(error.message);process.exitCode=1;}
 finally{win?.destroy();fs.rmSync(scratch,{recursive:true,force:true});app.quit();}
});
