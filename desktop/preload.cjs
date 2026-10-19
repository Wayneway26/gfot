const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('gfotDesktop',{platform:process.platform,chooseFolder:()=>ipcRenderer.invoke('gfot:folder')});
