import { POST as v2Post } from "../webhook-v2/route";
import { appUrl, sameSecret, telegram } from "../../../lib/server/telegram";
import { clearJarvisMemory, rememberJarvis } from "../../../lib/server/jarvis-brain";
import { loadJarvisContext } from "../../../lib/server/jarvis";
import { executeInviteMember, runJarvisAgentV3, type JarvisV3Action } from "../../../lib/server/jarvis-agent-v3";
import { describeTelegramPhoto } from "../../../lib/server/jarvis-media";
import { sanitizeV3Actions } from "../../../lib/server/jarvis-permissions-v3";
import { renderV3ProposalDetailed, renderV3ResultDetailed } from "../../../lib/server/jarvis-render-v3";

export const runtime="nodejs";
export const maxDuration=60;

async function send(chatId:number,text:string,extra:Record<string,unknown>={}){
  return telegram("sendMessage",{chat_id:chatId,text,...extra});
}
async function sendRemembered(ctx:NonNullable<Awaited<ReturnType<typeof loadJarvisContext>>>,chatId:number,text:string,extra:Record<string,unknown>={}){
  const result=await send(chatId,text,extra);await rememberJarvis(ctx as any,chatId,"assistant",text);return result;
}
function isGroup(type:unknown){return type==="group"||type==="supergroup";}
function groupCommand(text:string){
  const source=text.trim();const username=(process.env.TELEGRAM_BOT_USERNAME||"ne_uslozhnyay_tasks_bot").replace(/^@/,"");
  const escaped=username.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const patterns=[new RegExp(`^\\/jarvis(?:@${escaped})?(?:\\s+|$)`,`i`),new RegExp(`^@${escaped}(?:\\s*[:,]\\s*|\\s+|$)`,`i`),/^(?:джарвис|jarvis)(?:\s*[:,]\s*|\s+|$)/i];
  for(const p of patterns)if(p.test(source))return {explicit:true,text:source.replace(p,"").trim()};
  return {explicit:false,text:source};
}
function replyText(message:any){
  const r=message?.reply_to_message;if(!r)return null;
  const text=typeof r.text==="string"?r.text:typeof r.caption==="string"?r.caption:"";
  return text.trim().slice(0,2500)||null;
}
async function transcribeVoice(message:any){
  const voice=message?.voice;if(!voice?.file_id)return null;
  if(Number(voice.file_size||0)>10_000_000||Number(voice.duration||0)>180)throw new Error("Voice too large");
  const token=process.env.TELEGRAM_BOT_TOKEN;const key=process.env.OPENAI_API_KEY;if(!token||!key)throw new Error("Voice not configured");
  const info=await telegram("getFile",{file_id:voice.file_id}) as {file_path?:string};if(!info?.file_path)throw new Error("Telegram file unavailable");
  const file=await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`,{signal:AbortSignal.timeout(12000),cache:"no-store"});if(!file.ok)throw new Error("Voice download failed");
  const blob=await file.blob();const form=new FormData();form.append("file",blob,"voice.ogg");form.append("model",process.env.OPENAI_TRANSCRIBE_MODEL||"gpt-4o-mini-transcribe");form.append("language","ru");
  const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(30000),cache:"no-store"});
  if(!response.ok)throw new Error(`Transcription ${response.status}`);const data=await response.json() as {text?:string};return data.text?.trim().slice(0,5000)||null;
}

async function handleCallback(update:any){
  const callback=update?.callback_query;const match=typeof callback?.data==="string"?callback.data.match(/^j3:(ok|no):([0-9a-f-]{36})$/i):null;
  if(!match)return null;if(callback.from?.is_bot||!callback.message?.chat)return Response.json({ok:true});
  const type=callback.message.chat.type;const privateChat=type==="private";const groupChat=isGroup(type);if(!privateChat&&!groupChat)return Response.json({ok:true});
  const chatId=callback.message.chat.id;const actorId=callback.from?.id;if(!Number.isSafeInteger(chatId)||!Number.isSafeInteger(actorId)||actorId<=0)return Response.json({ok:true});if(privateChat&&chatId!==actorId)return Response.json({ok:true});
  const ctx=await loadJarvisContext(actorId);if(!ctx){await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Telegram не привязан к NU TEAM"});return Response.json({ok:true});}
  const q=await ctx.admin.from("jarvis_action_bundles").select("id,user_id,chat_id,actions,expires_at").eq("id",match[2]).eq("user_id",ctx.me.id).eq("chat_id",chatId).maybeSingle();
  const bundle=q.data;if(q.error||!bundle){await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Подтверждение принадлежит другому сотруднику, уже выполнено или устарело"});return Response.json({ok:true});}
  if(Date.parse(bundle.expires_at)<Date.now()){
    await ctx.admin.from("jarvis_action_bundles").delete().eq("id",bundle.id);await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Подтверждение устарело"});await telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}});await sendRemembered(ctx,chatId,"Подтверждение устарело. Повтори просьбу, я соберу свежий пакет.");return Response.json({ok:true});
  }
  const actions=(bundle.actions||[]) as JarvisV3Action[];
  if(match[1]==="no"){
    await ctx.admin.from("jarvis_action_bundles").delete().eq("id",bundle.id);await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Отменено"});await telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}});await sendRemembered(ctx,chatId,"Отменил. Ничего не изменено.");return Response.json({ok:true});
  }
  try{
    if(actions.length===1&&actions[0].type==="invite_member"){
      await executeInviteMember(ctx as any,actions[0],appUrl());
    }else{
      const applied=await ctx.admin.rpc("nu_jarvis_apply_action_bundle_v2",{p_actor:ctx.me.id,p_actions:actions});if(applied.error)throw applied.error;
    }
    await ctx.admin.from("jarvis_action_bundles").delete().eq("id",bundle.id);await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:"Готово"});await telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}});await sendRemembered(ctx,chatId,renderV3ResultDetailed(ctx as any,actions));return Response.json({ok:true});
  }catch(error:any){
    const message=String(error?.message||"");console.error("Jarvis v3 action failed",{code:error?.code||null,message:message.slice(0,200)});
    const stale=message.includes("Task changed since proposal");if(stale)await ctx.admin.from("jarvis_action_bundles").delete().eq("id",bundle.id);
    await telegram("answerCallbackQuery",{callback_query_id:callback.id,text:stale?"Задача уже изменилась":"Не применилось"});
    await sendRemembered(ctx,chatId,stale?"Задача изменилась после того, как я подготовил пакет. Ничего не перезаписал. Повтори просьбу, и я соберу изменения по свежим данным.":"Не смог применить пакет. Ничего не изменено; подтверждение сохранено для повторной попытки.");return Response.json({ok:true});
  }
}

export async function POST(request:Request){
  const v2Request=request.clone();if(!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"),process.env.TELEGRAM_WEBHOOK_SECRET))return Response.json({error:"Forbidden"},{status:403});
  let update:any;try{update=await request.json();}catch{return v2Post(v2Request);}
  if(update?.callback_query){const cb=await handleCallback(update);if(cb)return cb;return v2Post(v2Request);}
  const message=update?.message;const type=message?.chat?.type;const privateChat=type==="private";const groupChat=isGroup(type);const chatId=message?.chat?.id;const actorId=message?.from?.id;
  if(!message||message.from?.is_bot||(!privateChat&&!groupChat)||!Number.isSafeInteger(chatId)||!Number.isSafeInteger(actorId)||actorId<=0)return Response.json({ok:true});if(privateChat&&chatId!==actorId)return Response.json({ok:true});

  const rawText=typeof message.text==="string"?message.text.trim():typeof message.caption==="string"?message.caption.trim():"";
  const group=groupChat?groupCommand(rawText):{explicit:true,text:rawText};
  if(groupChat&&!group.explicit)return Response.json({ok:true});
  if(privateChat&&/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i.test(rawText))return v2Post(v2Request);
  const ctx=await loadJarvisContext(actorId);if(!ctx){await send(chatId,groupChat?"Сначала подключи свой Telegram к NU TEAM в личном чате с ботом.":"Открой NU TEAM → Telegram → «Подключить», затем перейди по персональной ссылке.");return Response.json({ok:true});}

  if(privateChat&&Number.isSafeInteger(message.reply_to_message?.message_id)){
    const check=await ctx.admin.from("telegram_checkin_sessions").select("id").eq("user_id",ctx.me.id).eq("message_id",message.reply_to_message.message_id).eq("state","awaiting").maybeSingle();if(check.data)return v2Post(v2Request);
  }

  let text=group.text;
  if(!text&&message.voice){
    if(groupChat)return Response.json({ok:true});
    try{text=await transcribeVoice(message)||"";}catch{await send(chatId,"Не смог разобрать голосовое. Отправь его ещё раз или напиши текстом.");return Response.json({ok:true});}
  }
  if(Array.isArray(message.photo)&&message.photo.length){
    try{
      const vision=await describeTelegramPhoto(message);
      if(vision)text=[text||"Проанализируй изображение в контексте NU OS.",`Контекст изображения: ${vision}`].join("\n\n");
    }catch{await send(chatId,"Не смог разобрать изображение. Пришли его ещё раз или добавь текстовое пояснение.");return Response.json({ok:true});}
  }
  if(!text){await send(chatId,"Сейчас понимаю текст, голосовые и изображения. Для других файлов добавь текстовое пояснение.");return Response.json({ok:true});}
  if(privateChat&&/^(?:новый диалог|сбрось контекст|очисти контекст|забудь контекст)[.!]?$/i.test(text)){await clearJarvisMemory(ctx as any,chatId);await sendRemembered(ctx,chatId,"Контекст очищен. Начинаем с чистого листа.");return Response.json({ok:true});}

  const context=replyText(message);const agent=await runJarvisAgentV3(ctx as any,chatId,text,context);
  if(!agent){await send(chatId,"AI-мозг Jarvis временно недоступен. Данные я не менял. Попробуй ещё раз через несколько секунд.");return Response.json({ok:true});}
  await rememberJarvis(ctx as any,chatId,"user",message.voice?`[Голосовое] ${text}`:Array.isArray(message.photo)&&message.photo.length?`[Изображение] ${text}`:text);
  if(agent.mode==="reply"){await sendRemembered(ctx,chatId,agent.reply||"Не смог сформулировать ответ.",groupChat?{reply_parameters:{message_id:message.message_id,allow_sending_without_reply:true}}:{});return Response.json({ok:true});}
  const safeActions=sanitizeV3Actions(ctx as any,agent.actions);
  if(!safeActions.length){await sendRemembered(ctx,chatId,"По твоей роли это изменение недоступно. Данные не менял.");return Response.json({ok:true});}
  await ctx.admin.from("jarvis_action_bundles").delete().eq("user_id",ctx.me.id).lt("expires_at",new Date().toISOString());
  const saved=await ctx.admin.from("jarvis_action_bundles").insert({user_id:ctx.me.id,chat_id:chatId,actions:safeActions}).select("id").single();
  if(saved.error||!saved.data?.id){console.error("Jarvis v3 bundle save failed",{code:saved.error?.code});await sendRemembered(ctx,chatId,"Не смог подготовить подтверждение. Ничего не изменено.");return Response.json({ok:true});}
  await sendRemembered(ctx,chatId,renderV3ProposalDetailed(ctx as any,safeActions),{reply_markup:{inline_keyboard:[[{text:"✅ Подтвердить",callback_data:`j3:ok:${saved.data.id}`},{text:"❌ Отмена",callback_data:`j3:no:${saved.data.id}`}]]},...(groupChat?{reply_parameters:{message_id:message.message_id,allow_sending_without_reply:true}}:{})});
  return Response.json({ok:true});
}
