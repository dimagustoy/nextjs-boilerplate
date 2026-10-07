import { adminClient, appUrl, telegram } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request:Request){
  const token=request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if(!token)return Response.json({error:"Forbidden"},{status:403});
  const deployEnv=process.env.NU_ENV||process.env.VERCEL_ENV;
  if(deployEnv&&deployEnv!=="production")return Response.json({error:"Production only"},{status:403});
  try{
    const admin=adminClient();
    const authorized=await admin.rpc("nu_telegram_dispatch_authorize",{p_secret:token});
    if(authorized.error||!authorized.data)return Response.json({error:"Forbidden"},{status:403});
    const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
    if(!secret)return Response.json({error:"Webhook secret missing"},{status:503});
    await telegram("setWebhook",{
      url:`${appUrl()}/api/telegram/webhook-v2`,
      secret_token:secret,
      allowed_updates:["message","callback_query"],
      max_connections:2,
    });
    const info=await telegram("getWebhookInfo",{}) as {url?:string;pending_update_count?:number;last_error_message?:string};
    return Response.json({ok:true,url:info.url||null,pending:info.pending_update_count||0,lastError:info.last_error_message||null});
  }catch(error){
    console.error("Telegram v2 bootstrap failed",{name:error instanceof Error?error.name:"UnknownError"});
    return Response.json({error:"Bootstrap failed"},{status:503});
  }
}
