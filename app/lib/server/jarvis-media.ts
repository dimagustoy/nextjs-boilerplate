import { telegram } from "./telegram";

async function telegramFile(fileId:string,maxBytes:number){
  const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw new Error("Telegram not configured");
  const info=await telegram("getFile",{file_id:fileId}) as {file_path?:string;file_size?:number};
  if(!info?.file_path)throw new Error("Telegram file unavailable");
  if(Number(info.file_size||0)>maxBytes)throw new Error("File too large");
  const response=await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`,{signal:AbortSignal.timeout(15000),cache:"no-store"});
  if(!response.ok)throw new Error("Telegram file download failed");
  const bytes=await response.arrayBuffer();if(bytes.byteLength>maxBytes)throw new Error("File too large");
  return {bytes,mime:response.headers.get("content-type")||"image/jpeg"};
}

export async function describeTelegramPhoto(message:any){
  const photos=Array.isArray(message?.photo)?message.photo:[];if(!photos.length)return null;
  const key=process.env.OPENAI_API_KEY;if(!key)throw new Error("AI not configured");
  const chosen=[...photos].sort((a,b)=>Number(b.file_size||0)-Number(a.file_size||0))[0];
  const file=await telegramFile(chosen.file_id,8_000_000);
  const base64=Buffer.from(file.bytes).toString("base64");
  const caption=typeof message.caption==="string"?message.caption.trim():"";
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
    body:JSON.stringify({
      model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||"gpt-6-luna",
      reasoning:{effort:"low"},
      input:[{role:"user",content:[
        {type:"input_text",text:`Опиши изображение для рабочего AI-ассистента NU OS. Извлеки весь важный видимый текст, названия, числа, сроки, списки и контекст. Не выдумывай невидимое. Если это скрин интерфейса/переписки/документа, сначала передай смысл текста, затем важные детали. Подпись пользователя: ${caption||"нет"}`},
        {type:"input_image",image_url:`data:${file.mime};base64,${base64}`},
      ]}],
      max_output_tokens:1200,
      store:false,
    }),
    signal:AbortSignal.timeout(35000),cache:"no-store",
  });
  if(!response.ok)throw new Error(`Vision ${response.status}`);
  const data=await response.json() as any;
  if(typeof data?.output_text==="string")return data.output_text.trim().slice(0,6000);
  for(const item of data?.output||[])for(const content of item?.content||[])if(typeof content?.text==="string")return content.text.trim().slice(0,6000);
  return null;
}
