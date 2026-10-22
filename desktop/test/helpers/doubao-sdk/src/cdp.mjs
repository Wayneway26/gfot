export const cdpStatus=async()=>({available:true});
export const withChatClient=async fn=>fn({evaluate:async()=> 'synthetic-account'});
