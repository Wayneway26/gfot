// Runs before the stylesheet so the first page frame uses the saved appearance.
(()=>{
 const root=document.documentElement,media=window.matchMedia('(prefers-color-scheme: dark)');
 const normalize=value=>['light','dark','system'].includes(value)?value:'system';
 let preference='system',pending=false;
 try{preference=normalize(window.gfotDesktop?.initialTheme??localStorage.getItem('gfot-theme'));}catch{}
 function apply(){
  root.dataset.theme=preference==='system'?(media.matches?'dark':'light'):preference;
  root.dataset.themePreference=preference;
  for(const button of document.querySelectorAll('[data-theme-choice]')){button.setAttribute('aria-pressed',String(button.dataset.themeChoice===preference));button.disabled=pending;}
 }
 apply();media.addEventListener('change',()=>{if(preference==='system')apply();});
 document.addEventListener('DOMContentLoaded',()=>{
  apply();root.dataset.themeReady='true';
  for(const button of document.querySelectorAll('[data-theme-choice]'))button.addEventListener('click',async()=>{
   if(pending)return;const next=normalize(button.dataset.themeChoice);pending=true;apply();const error=document.querySelector('#theme-error');if(error)error.textContent='';
   try{
    if(window.gfotDesktop?.setTheme)await window.gfotDesktop.setTheme(next);
    else localStorage.setItem('gfot-theme',next);
    preference=next;
   }catch{if(error)error.textContent='外观未保存，请重试。';}
   finally{pending=false;apply();}
  });
 });
})();
