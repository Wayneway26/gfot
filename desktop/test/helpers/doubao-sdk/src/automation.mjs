export async function createConversation(_text,options){const receipt={conversationId:'123456789012',runId:'123456789013'};options.onReceipt(receipt);return receipt;}
export const sendMessage=async(_id,text,options)=>createConversation(text,options);
export const taskStatus=async()=>({status:'completed',reply:{text:'豆包 synthetic native turn completed'}});
export const stopConversation=async()=>({stopped:true});
