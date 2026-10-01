// Tests run against PostgreSQL (PGlite), with a controlled clock.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const path = require('node:path');
const vm = require('node:vm');
const transpiled = ts.transpileModule(fs.readFileSync('app/lib/recurring.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const context = {exports:{},Intl,Date}; vm.runInNewContext(transpiled,context);
const {managerPresets,occurrences,scheduleDefaults} = context.exports;
const owner='00000000-0000-4000-8000-000000000001', manager='00000000-0000-4000-8000-000000000002', other='00000000-0000-4000-8000-000000000003';
(async()=>{
 const {PGlite}=await import(process.env.NU_PGLITE_PATH || '@electric-sql/pglite'); const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function nu_test_now() returns timestamptz language sql stable as $$select current_setting('nu.test_now')::timestamptz$$;
 select set_config('nu.test_now','2026-10-01 08:00:00+05',false);
 create table profiles(id uuid primary key, role text, is_active boolean);
 create table projects(id uuid primary key);
 create table tasks(id uuid primary key default gen_random_uuid(),title text,description text,expected_result text,assignee_id uuid,created_by uuid,project_id uuid,priority text,status text,deadline timestamptz,updated_at timestamptz,completed_at timestamptz);
 create table task_history(id uuid primary key default gen_random_uuid(),task_id uuid references tasks(id) on delete cascade,user_id uuid,action text,old_value jsonb,new_value jsonb);
 create table task_comments(id uuid primary key default gen_random_uuid(),task_id uuid references tasks(id) on delete cascade,author_id uuid,body text);
 create table deadline_requests(id uuid primary key default gen_random_uuid(),task_id uuid,requested_by uuid,old_deadline timestamptz,requested_deadline timestamptz,reason text,status text,decided_by uuid,decided_at timestamptz);
 insert into profiles values('${owner}','owner',true),('${manager}','manager',true),('${other}','smm',true);
 grant usage on schema public,auth to authenticated;
 grant select on profiles to authenticated;
 `);
 const apply=async name=>db.exec(fs.readFileSync(path.join('supabase/migrations',name),'utf8').replaceAll('now()','public.nu_test_now()'));
 for(const f of ['20260929010000_task_management.sql','20260929020000_owner_task_controls.sql','20260929030000_recurring_tasks.sql','20260930010000_telegram.sql']) await apply(f);
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
 // Legacy monthly task, including a manually changed deadline.
 await db.query(`insert into recurring_task_templates(title,expected_result,assignee_id,created_by,due_day) values('Legacy','Done',$1,$2,31)`,[manager,owner]);
 await db.exec(`select nu_generate_recurring('2026-10-01');`);
 await db.exec("update tasks set deadline='2026-11-02 23:59:00+05'");
 await apply('20261001010000_recurring_calendar.sql');
 const scalar=async(q,args=[]) => (await db.query(q,args)).rows[0].v;
 assert.equal(await scalar("select period::text v from recurring_task_instances"),'2026-10-31');
 for (const preset of managerPresets) {
   const data={...preset,starts_on:'2020-01-01',assignee_id:manager,created_by:owner};
   const keys=Object.keys(data); await db.query(`insert into recurring_task_templates(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(data));
 }
 const templates=(await db.query('select * from recurring_task_templates where preset_key is not null')).rows;
 assert.equal(templates.length,30);
 assert.equal(occurrences({...scheduleDefaults,starts_on:'2020-01-01',due_day:31},'2027-02-01')[0].due,'2027-02-28');
 // Compare actual SQL calendar and displayed calendar for every month over a leap-year cycle.
 for (let y=2026;y<=2029;y++) for(let m=1;m<=12;m++) {
   const month=`${y}-${String(m).padStart(2,'0')}-01`;
   const sql=(await db.query(`select r.preset_key,d.due_date::text as due,d.notify_date::text as notify,d.offsets from recurring_task_templates r cross join lateral nu_recurring_dates(r,$1) d where r.preset_key is not null order by r.preset_key,d.due_date`,[month])).rows;
   const js=templates.flatMap(r=>occurrences(r,month).map(d=>({preset_key:r.preset_key,...d}))).sort((a,b)=>a.preset_key.localeCompare(b.preset_key)||a.due.localeCompare(b.due));
   // Normalize cross-realm arrays before strict comparison.
   assert.deepEqual(JSON.parse(JSON.stringify(js)),sql,month);
 }
 const byKey=(key)=>templates.find(r=>r.preset_key===`manager-v1:${key}`);
 assert.equal(occurrences(byKey('nu3-readings'),'2028-02-01')[0].due,'2028-02-29');
 assert.equal(occurrences(byKey('nu3-readings'),'2027-02-01')[0].due,'2027-02-28');
 assert.equal(occurrences(byKey('shifts'),'2026-09-01')[0].notify,'2026-09-22');
 assert.equal(occurrences(byKey('shifts'),'2026-09-01')[0].due,'2026-09-26');
 assert.equal(occurrences(byKey('reports'),'2027-01-01')[0].notify,'2026-12-29');
 assert.equal(occurrences(byKey('nu4-readings'),'2026-10-01')[0].due,'2026-10-20');
 assert.equal(occurrences(byKey('nu4-readings'),'2026-10-01')[0].notify,'2026-10-20');
 // Clock boundary, dedupe, deleted-task tombstones, identity restoration.
 await db.exec("select set_config('nu.test_now','2026-10-01 07:59:59+05',false)");
 assert.equal(await scalar("select nu_generate_recurring('2026-10-01') v"),0);
 await db.exec("select set_config('nu.test_now','2026-10-01 08:00:00+05',false)");
 await db.query('insert into telegram_links(user_id,chat_id) values($1,123)',[manager]);
 const count=await scalar("select nu_generate_recurring('2026-10-01') v"); assert(count>0);
 assert.equal(await scalar("select nu_generate_recurring('2026-10-01') v"),0);
 assert.equal(await scalar("select auth.uid()::text v"),owner);
 const daily=(await db.query("select i.task_id from recurring_task_instances i join recurring_task_templates r on r.id=i.template_id where r.preset_key='manager-v1:staff'")).rows[0].task_id;
 await db.query('delete from tasks where id=$1',[daily]);
 assert.equal(await scalar("select nu_generate_recurring('2026-10-01') v"),0);
 assert.equal(await scalar("select count(*)::int v from recurring_task_instances where task_id is null"),1);
 // New task notification must not be doubled by a reminder on the same date.
 assert.equal(await scalar('select nu_telegram_reminders() v'),0);
 await db.exec("select set_config('nu.test_now','2026-10-02 08:00:00+05',false)");
 assert.equal(await scalar("select nu_generate_recurring('2026-10-01') v"),3); // Two daily tasks + Sunday visit released Friday.
 // Editing an already generated monthly deadline must not produce a second task.
 await db.exec("update recurring_task_templates set due_day=4,reminder_days=array[2] where preset_key='manager-v1:nu4-rent'");
 assert.equal(await scalar("select nu_generate_recurring('2026-10-01') v"),0);
 // RLS: manager reads own rules, cannot write or run generation; other staff cannot see them.
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${manager}',false);`);
 assert.equal(await scalar('select count(*)::int v from recurring_task_templates'),31);
 await assert.rejects(db.query("insert into recurring_task_templates(title,expected_result,assignee_id,created_by,due_day) values('Bad','Bad',$1,$1,1)",[manager]),/row-level security/);
 assert.equal((await db.query('update recurring_task_templates set is_active=false returning id')).rows.length,0);
 await assert.rejects(db.query("select nu_generate_recurring('2026-10-01')"),/Only owner/);
 await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
 assert.equal(await scalar('select count(*)::int v from recurring_task_templates'),0);
 assert.equal(await scalar('select count(*)::int v from recurring_task_instances'),0);
 await db.exec(`reset role; select set_config('request.jwt.claim.sub','${owner}',false);`);
 await apply('20261001020000_task_checklists.sql');
 const checklistTask=await scalar("select id::text v from tasks where title='Контроль персонала' limit 1");
 await db.query("update tasks set description=E'Чек-лист:\n• Открытие смены\n• Проверка отчётов' where id=$1",[checklistTask]);
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${manager}',false);`);
 await db.query("select nu_set_checklist_item($1,0,'Открытие смены',true)",[checklistTask]);
 assert.equal(await scalar('select done v from task_checklist_items where task_id=$1',[checklistTask]),true);
 await assert.rejects(db.query("select nu_set_checklist_item($1,1,'Подменённый пункт',true)",[checklistTask]),/Checklist changed/);
 await assert.rejects(db.query('update task_checklist_items set done=false'),/permission denied/);
 await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
 assert.equal(await scalar('select count(*)::int v from task_checklist_items'),0);
 await assert.rejects(db.query("select nu_set_checklist_item($1,0,'Открытие смены',false)",[checklistTask]),/Checklist update denied/);
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
 await db.query("update tasks set status='completed' where id=$1",[checklistTask]);
 await assert.rejects(db.query("select nu_set_checklist_item($1,0,'Открытие смены',false)",[checklistTask]),/Checklist update denied/);
 await db.exec(`reset role; select set_config('request.jwt.claim.sub','${owner}',false); update profiles set is_active=false where id='${owner}'; set role authenticated;`);
 await assert.rejects(db.query("select nu_generate_recurring('2026-10-01')"),/Only owner/);
 await db.close(); console.log('PASS: 30 presets × 48 months, leap years, parity, weekdays, cross-month reminders, 08:00 boundary, dedupe, deletion, Telegram dedupe, checklist authorization/audit and RLS.');
})().catch(e=>{console.error(e);process.exit(1)});
