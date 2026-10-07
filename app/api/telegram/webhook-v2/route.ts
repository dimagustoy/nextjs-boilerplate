import { POST as legacyPost } from "../webhook/route";
import { sameSecret, telegram } from "../../../lib/server/telegram";
import { clearJarvisMemory, rememberJarvis } from "../../../lib/server/jarvis-brain";
import { loadJarvisContext } from "../../../lib/server/jarvis";
import { renderActionProposal, renderActionResult, runJarvisAgent, type JarvisAction } from "../../../lib/server/jarvis-agent";

export const runtime = "nodejs";
export const maxDuration = 60;

async function send(chatId:number,text:string,extra:Record<string,unknown>={}){
  return telegram("sendMessage",{chat_id:chatId,text,...extra});
}

async function sendRemembered(ctx:NonNullable<Awaited<ReturnType<typeof loadJarvisContext>>>,chatId:number,text:string,extra:Record<string,unknown>={}){
  const result=await send(chatId,text,extra);
  await rememberJarvis(ctx as any,chatId,"assistant",text);
  return result;
}

async function handleBundleCallback(update:any){
  const callback=update?.callback_query;
  const match=typeof callback?.data==="string"?callback.data.match(/^ja:(ok|no):([0-9a-f-]{36})$/i):null;
  if(!match)return null;
  if(callback.from?.is_bot||callback.message?.chat?.type!=="private")return Response.json({ok:true});
  const chatId=callback.message.chat.id;
  const actorTelegramId=callback.from?.id;
  if(!Number.isSafeInteger(chatId)||!Number.isSafeInteger(actorTelegramId)||chatId!==actorTelegramId)return Response.json({ok:true});
  const ctx=await loadJarvisContext(actorTelegramId);
  if(!ctx){
    await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Telegram не привязан к NU TEAM"});
    return Response.json({ok:true});
  }
  const {data:bundle,error}=await ctx.admin.from("jarvis_action_bundles")
    .select("id,user_id,chat_id,actions,expires_at")
    .eq("id",match[2]).eq("user_id",ctx.me.id).eq("chat_id",chatId).maybeSingle();
  if(error||!bundle){
    await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Действие уже выполнено или устарело"});
    return Response.json({ok:true});
  }
  if(new Date(bundle.expires_at).getTime()<Date.now()){
    await ctx.admin.from("jarvis_action_bundles").delete().eq("id",bundle.id);
    await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Подтверждение устарело"});
    await telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}});
    await sendRemembered(ctx,chatId,"Подтверждение устарело. Повтори просьбу, и я подготовлю действие заново.");
    return Response.json({ok:true});
  }
  const actions=(bundle.actions||[]) as JarvisAction[];
  if(match[1]==="no"){
    await ctx.admin.from("jarvis_action_bundles").delete().eq("id",bundle.id);
    await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Отменено"});
    await telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}});
    await sendRemembered(ctx,chatId,"Отменил. Ничего не изменено.");
    return Response.json({ok:true});
  }
  const applied=await ctx.admin.rpc("nu_jarvis_apply_action_bundle",{p_actor:ctx.me.id,p_actions:actions});
  if(applied.error){
    console.error("Jarvis action bundle failed",{code:applied.error.code,message:applied.error.message});
    await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Не применилось"});
    await sendRemembered(ctx,chatId,"Не смог применить пакет. Ничего не изменено. Я сохранил подтверждение, можно попробовать ещё раз после исправления причины.");
    return Response.json({ok:true});
  }
  await ctx.admin.from("jarvis_action_bundles").delete().eq("id",bundle.id);
  await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Готово"});
  await telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}});
  await sendRemembered(ctx,chatId,renderActionResult(ctx as any,actions));
  return Response.json({ok:true});
}

export async function POST(request:Request){
  const legacyRequest=request.clone();
  if(!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"),process.env.TELEGRAM_WEBHOOK_SECRET)){
    return Response.json({error:"Forbidden"},{status:403});
  }
  let update:any;
  try{ update=await request.json(); }catch{ return legacyPost(legacyRequest); }

  const callbackResult=await handleBundleCallback(update);
  if(callbackResult)return callbackResult;

  const message=update?.message;
  if(!message||message.from?.is_bot||message.chat?.type!=="private")return legacyPost(legacyRequest);
  const chatId=message.chat.id;
  const actorTelegramId=message.from?.id;
  if(!Number.isSafeInteger(chatId)||!Number.isSafeInteger(actorTelegramId)||chatId!==actorTelegramId)return legacyPost(legacyRequest);
  const text=typeof message.text==="string"?message.text.trim():"";
  if(!text||/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i.test(text))return legacyPost(legacyRequest);

  const ctx=await loadJarvisContext(actorTelegramId);
  if(!ctx)return legacyPost(legacyRequest);

  if(Number.isSafeInteger(message.reply_to_message?.message_id)){
    const {data:checkin}=await ctx.admin.from("telegram_checkin_sessions")
      .select("id").eq("user_id",ctx.me.id).eq("message_id",message.reply_to_message.message_id).eq("state","awaiting").maybeSingle();
    if(checkin)return legacyPost(legacyRequest);
  }

  if(/^(?:новый диалог|сбрось контекст|очисти контекст|забудь контекст)[.!]?$/i.test(text)){
    await clearJarvisMemory(ctx as any,chatId);
    await sendRemembered(ctx,chatId,"Контекст очищен. Начинаем с чистого листа.");
    return Response.json({ok:true});
  }

  const agent=await runJarvisAgent(ctx as any,chatId,text);
  if(!agent){
    await send(chatId,"AI-мозг Jarvis сейчас временно недоступен. Я не буду притворяться старым командным ботом и делать вид, что понял тебя. Попробуй сообщение ещё раз чуть позже.");
    return Response.json({ok:true});
  }
  await rememberJarvis(ctx as any,chatId,"user",text);

  if(agent.mode==="reply"){
    await sendRemembered(ctx,chatId,agent.reply||"Не смог сформулировать ответ.");
    return Response.json({ok:true});
  }

  await ctx.admin.from("jarvis_action_bundles").delete().eq("user_id",ctx.me.id).lt("expires_at",new Date().toISOString());
  const {data:bundle,error}=await ctx.admin.from("jarvis_action_bundles")
    .insert({user_id:ctx.me.id,chat_id:chatId,actions:agent.actions}).select("id").single();
  if(error||!bundle?.id){
    console.error("Jarvis action bundle save failed",{code:error?.code});
    await sendRemembered(ctx,chatId,"Не смог подготовить подтверждение. Ничего не изменено.");
    return Response.json({ok:true});
  }
  const proposal=renderActionProposal(ctx as any,agent.actions);
  await sendRemembered(ctx,chatId,proposal,{
    reply_markup:{inline_keyboard:[[
      {text:"✅ Подтвердить",callback_data:`ja:ok:${bundle.id}`},
      {text:"❌ Отмена",callback_data:`ja:no:${bundle.id}`},
    ]]},
  });
  return Response.json({ok:true});
}
