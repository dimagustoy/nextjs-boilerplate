const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname,'..',file);
  const module = new Module(filename);
  module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));
  const original=module.require.bind(module);
  module.require=(name) => Object.hasOwn(mocks,name) ? mocks[name] : original(name);
  module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return module.exports;
}
const helper=load('app/lib/server/telegram.ts',{'@supabase/supabase-js':{createClient(){throw new Error('Database must not be used');}}});
const helperPath='../../../lib/server/telegram';
test('Secret comparison fails closed; binding hashes do not contain token',()=>{
  assert.equal(helper.sameSecret(null,undefined),false);
  assert.equal(helper.sameSecret('abc',undefined),false);
  assert.equal(helper.sameSecret('abc','abcd'),false);
  assert.equal(helper.sameSecret('abc','abc'),true);
  assert.equal(helper.tokenHash('test').length,64);
});
test('Unauthenticated connect/setup/test denied before DB access',async()=>{
  for(const name of ['connect','setup','test']) {
    const route=load(`app/api/telegram/${name}/route.ts`,{[helperPath]:helper});
    const response=await route.POST(new Request('https://example.com',{method:'POST'}));
    assert.equal(response.status,401,name);
  }
});
test('Webhook and dispatcher reject missing or invalid secret before parsing body',async()=>{
  process.env.TELEGRAM_WEBHOOK_SECRET='valid-webhook-secret';
  process.env.TELEGRAM_DISPATCH_SECRET='valid-dispatch-secret';
  for(const name of ['webhook','dispatch']) {
    const route=load(`app/api/telegram/${name}/route.ts`,{[helperPath]:helper});
    const response=await route.POST(new Request('https://example.com',{method:'POST',body:'not JSON'}));
    assert.equal(response.status,403,name);
  }
});
test('Authenticated manager cannot configure production webhook',async()=>{
  const route=load('app/api/telegram/setup/route.ts',{[helperPath]:{...helper,activeUser:async()=>({role:'manager'})}});
  assert.equal((await route.POST(new Request('https://example.com',{method:'POST'}))).status,403);
});
test('Webhook ignores group and mismatched personal identity',async()=>{
  let calls=0;
  const route=load('app/api/telegram/webhook/route.ts',{[helperPath]:{...helper,telegram:async()=>{calls++;}}});
  for(const message of [{chat:{type:'group',id:123},from:{id:123},text:'/start x'},{chat:{type:'private',id:123},from:{id:456},text:'/start x'}]) {
    const r=await route.POST(new Request('https://example.com',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'valid-webhook-secret'},body:JSON.stringify({message})}));
    assert.equal(r.status,200);
  }
  assert.equal(calls,0);
});
test('Dispatcher suppresses message when task access was revoked',async()=>{
  let sent=0,ack;
  const admin={rpc:async(name,args)=>{
    if(name==='nu_telegram_claim') return {data:[{id:'item',lease_id:'lease',user_id:'user',chat_id:123,task_id:'task'}]};
    if(name==='nu_telegram_visible') return {data:false};
    if(name==='nu_telegram_finish') ack=args;
    return {data:0};
  },from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{chat_id:123}})})})})};
  process.env.TELEGRAM_BOT_TOKEN='test-only';
  const route=load('app/api/telegram/dispatch/route.ts',{[helperPath]:{...helper,adminClient:()=>admin,telegram:async()=>{sent++;}}});
  const r=await route.POST(new Request('https://example.com',{method:'POST',headers:{authorization:'Bearer valid-dispatch-secret'}}));
  assert.equal(r.status,200);assert.equal(sent,0);assert.equal(ack.p_code,403);
});
