const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('gfotDesktop',{platform:process.platform,chooseFolder:()=>ipcRenderer.invoke('gfot:folder'),importCodex:()=>ipcRenderer.invoke('gfot:import-codex'),loginChatGPT:accountId=>ipcRenderer.invoke('gfot:chatgpt-login',accountId)});
