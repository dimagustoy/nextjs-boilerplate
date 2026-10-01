// Local browser test only. All Supabase traffic is intercepted; no real account or data is used.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const out=process.env.NU_SCREENSHOT_DIR||'/tmp/nu-dashboard-preview';fs.mkdirSync(out,{recursive:true});
const ids={owner:'00000000-0000-4000-8000-000000000001',manager:'00000000-0000-4000-8000-000000000002',smm:'00000000-0000-4000-8000-000000000003'};
const staff=[{id:ids.owner,full_name:'Дмитрий',role:'owner',is_active:true},{id:ids.manager,full_name:'Алексей Смирнов',role:'manager',is_active:true},{id:ids.smm,full_name:'Анна',role:'smm',is_active:true}];
const now=Date.now();const after=d=>new Date(now+d*86400000).toISOString();
const tasks=[['Оплата КУ · НУ1','in_progress',-1],['График смен на октябрь','review',2],['Закупка табака','waiting',1],['Контроль персонала','in_progress',0],['Финансовая отчётность','new',0],['Проведение инвентаризации','completed',-1],['Аренда · НУ4','new',3]].map(([title,status,d],i)=>({id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,title,status,deadline:after(d===0?0.125:d),created_at:after(-4),completed_at:status==='completed'?after(-1):null,assignee_id:ids.manager,created_by:ids.owner,project_id:null,priority:'normal',description:'Чек-лист:\n• Проверить открытие смены\n• Проверить отчёты\n• Проверить закрытие смены',expected_result:'Все проверки выполнены, результаты указаны в комментарии.'}));
let checkItems=[];const pending={id:'request-1',task_id:tasks[2].id,requested_by:ids.manager,requested_deadline:after(4),reason:'Ожидаем поставку',status:'pending',created_at:after(-1)};
let previewServer;
(async()=>{
 if(process.env.NU_START_SERVER==='1') {
   const {spawn}=require('node:child_process');
   const server=previewServer=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{stdio:['ignore','pipe','pipe']});
   process.on('exit',()=>server.kill());
   await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Ready'))resolve();});server.on('exit',code=>reject(new Error('Preview server exited: '+code)));setTimeout(()=>reject(new Error('Preview start timed out')),15000).unref();});
 }

 const packaged=process.env.NU_CHROMIUM_PACKAGE ? (await import(process.env.NU_CHROMIUM_PACKAGE)).default : null;
 const browser=await chromium.launch({headless:true,...(packaged?{executablePath:await packaged.executablePath(),args:packaged.args}:{})});
 const context=await browser.newContext({viewport:{width:1536,height:1100},deviceScaleFactor:1});
 const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({id})=>{const exp=Math.floor(Date.now()/1000)+7200;const token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:id,exp,role:'authenticated'}))+'.test';localStorage.setItem('sb-placeholder-auth-token',JSON.stringify({access_token:token,refresh_token:'local-test-token',expires_at:exp,expires_in:7200,token_type:'bearer',user:{id,email:'test@example.invalid'}}));},{id:ids.owner});
 await page.route('https://placeholder.supabase.co/**',async route=>{
  const url=new URL(route.request().url());const table=url.pathname.split('/').pop();let body=[];
  if(url.pathname.startsWith('/auth/'))body={id:ids.owner,email:'test@example.invalid',aud:'authenticated',role:'authenticated'};
  else if(table==='profiles')body=url.searchParams.has('id')?staff.find(p=>p.id===url.searchParams.get('id').replace('eq.','')):staff;
  else if(table==='tasks')body=tasks;
  else if(table==='deadline_requests')body=url.searchParams.has('task_id')?(url.searchParams.get('task_id')==='eq.'+pending.task_id?[pending]:[]):[pending];
  else if(table==='task_checklist_items')body=checkItems;
  else if(table==='nu_set_checklist_item'){const v=route.request().postDataJSON();checkItems=[{item_index:v.p_index,label:v.p_label,done:v.p_done}];body=null;}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.route('**/api/telegram/connect',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,configured:true,username:'test_user'})}));
 await page.goto((process.env.NU_BASE_URL||'http://127.0.0.1:3100')+'/dashboard');await page.getByRole('heading',{name:'Всё под контролем.'}).waitFor();
 await page.screenshot({path:out+'/desktop.png',fullPage:true,animations:"disabled"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desktop must not overflow');
 await page.getByRole('button',{name:/Просрочено 1/}).click();await page.getByRole('heading',{name:'Задачи команды'}).waitFor();
 assert(await page.getByRole('button',{name:/Оплата КУ/}).count());
 await page.getByRole('button',{name:/Оплата КУ/}).click();await page.getByRole('dialog').waitFor();
 await page.getByRole('checkbox',{name:'Проверить открытие смены'}).click();await page.waitForFunction(()=>document.querySelector('input[type=checkbox]')?.checked);assert.equal(checkItems[0].done,true);
 await page.screenshot({path:out+'/task.png',fullPage:true,animations:"disabled"});
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('textbox',{name:'Поиск задач'}).fill('Финансовая');assert.equal(await page.getByRole('button',{name:/Оплата КУ/}).count(),0);
 assert.equal(await page.getByRole('button',{name:/Финансовая отчётность/}).count(),1);
 await page.getByRole('button',{name:'Сбросить фильтры'}).click();
 await page.getByRole('button',{name:'Создать задачу'}).click();await page.getByRole('dialog').waitFor();await page.getByLabel('Название',{exact:true}).fill('Тестовая задача');await page.keyboard.press('Escape');
 await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Календарь'}).click();await page.getByRole('heading',{name:'Регулярные задачи'}).waitFor();
 await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Команда'}).click();await page.getByRole('heading',{name:'Сотрудники'}).waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Обзор'}).click();
 await page.screenshot({path:out+'/mobile.png',fullPage:true,animations:"disabled"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile overview must not overflow');
 await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Мои',exact:true}).click();
 await page.getByRole('button',{name:'Открыть меню'}).click();await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Все задачи'}).click();
 await page.getByRole('button',{name:/Контроль персонала/}).click();await page.getByRole('dialog').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile drawer must not overflow');
 await page.screenshot({path:out+'/mobile-task.png',fullPage:true,animations:"disabled"});await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Открыть меню'}).click();await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Команда'}).click();
 await page.screenshot({path:out+'/mobile-team.png',fullPage:true,animations:"disabled"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile team must not overflow');
 assert.deepEqual(errors,[]);await browser.close();previewServer?.kill();console.log('PASS: desktop/mobile, attention links, filters/search, task drawer, checklist save, create form, calendar, team; no runtime errors.');
})().catch(e=>{console.error(e);process.exit(1)});
