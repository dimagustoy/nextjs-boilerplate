import type { V3Context } from "./jarvis-agent-v3";

export function hasExplicitWriteIntent(text:string){
  const n=text.toLocaleLowerCase("ru").replace(/ё/g,"е");
  if(/\b(создай|создать|поставь|поставить|поручи|поручить|назначь|назначить|добавь|добавить|измени|изменить|поменяй|поменять|перенеси|перенести|сдвинь|сдвинуть|закрой|закрыть|заверши|завершить|удали|удалить|убери|убрать|согласуй|согласовать|отклони|отклонить|активируй|активировать|деактивируй|деактивировать|отключи|отключить|включи|включить|пригласи|пригласить|отметь|отметить|привяжи|привязать|отвяжи|отвязать|переименуй|переименовать|очисти|очистить|сделай|сделать)\b/i.test(n))return true;
  if(/\b(create|update|change|move|assign|add|remove|delete|complete|close|approve|reject|invite|activate|deactivate)\b/i.test(n))return true;
  if(/^\s*(тогда|ок|да|эту|ее|его|их)\b/i.test(n)&&/(завтра|сегодня|послезавтра|понедель|вторник|сред|четверг|пятниц|суббот|воскрес|\b\d{1,2}[:.]\d{2}\b|приоритет|статус|дедлайн|срок)/i.test(n))return true;
  return false;
}

export async function jarvisRateAllowed(ctx:V3Context){
  const now=Date.now();
  const minute=new Date(now-60_000).toISOString();
  const hour=new Date(now-3_600_000).toISOString();
  const base=()=>ctx.admin.from("jarvis_chat_messages").select("id",{count:"exact",head:true}).eq("user_id",ctx.me.id).eq("role","user");
  const [m,h]=await Promise.all([base().gte("created_at",minute),base().gte("created_at",hour)]);
  if(m.error||h.error)return true;
  const minuteLimit=ctx.me.role==="owner"?30:15;
  const hourLimit=ctx.me.role==="owner"?400:150;
  return (m.count||0)<minuteLimit&&(h.count||0)<hourLimit;
}
