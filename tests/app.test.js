import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/app.js';
import { invoiceAmounts } from '../server/security.js';

let db,server,base,owner,outsider,client,project,invoice,portal,member;
async function request(path,method='GET',body,cookie){
 const res=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','X-Clienter-Request':'1',...(cookie?{cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
function ok(result,status=200){assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
before(async()=>{
 process.env.NODE_ENV='test';
 const memory=newDb();const adapter=memory.adapters.createPg();db=new adapter.Pool();
 await db.query(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
 server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(r=>server.close(r));await db.end();});
test('health is public, workspace requires authentication, writes require verification',async()=>{
 ok(await request('/health'));assert.equal((await request('/bootstrap')).status,401);
 const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
});
test('register owner and independent workspace; passwords are hashed',async()=>{
 let r=await request('/auth/register','POST',{name:'Sanjay',email:'owner@example.test',password:'StrongPassword123!',workspace:'Medfluence'});ok(r,201);owner=r.cookie;assert.ok(owner);
 r=await request('/auth/register','POST',{name:'Other',email:'other@example.test',password:'StrongPassword123!',workspace:'Other agency'});ok(r,201);outsider=r.cookie;
 const users=(await db.query('SELECT * FROM users')).rows;assert.equal(users.length,2);assert.notEqual(users[0].password_hash,'StrongPassword123!');
 const b=ok(await request('/bootstrap','GET',undefined,owner));assert.equal(b.workspace.name,'Medfluence');assert.equal(b.clients.length,0);
 assert.equal((await request('/auth/login','POST',{email:'owner@example.test',password:'wrong'})).status,401);
});
test('create clients, prevent cross-workspace reads and foreign associations',async()=>{
 client=ok(await request('/clients','POST',{name:'Dr Example',email:'client@example.test',company:'Example Clinic'},owner),201);
 assert.equal((await request(`/clients/${client.id}`,'PATCH',{name:'Stolen'},outsider)).status,404);
 assert.equal((await request('/projects','POST',{name:'Cross-workspace',client_id:client.id},outsider)).status,404);
 assert.equal(ok(await request('/bootstrap','GET',undefined,outsider)).clients.length,0);
 project=ok(await request('/projects','POST',{name:'October content',client_id:client.id,budget:3500000,status:'In progress'},owner),201);
});
test('lead conversion carries client data and cannot run twice',async()=>{
 const lead=ok(await request('/leads','POST',{name:'New client',email:'lead@example.test',value:3000000},owner),201);
 ok(await request(`/leads/${lead.id}/convert`,'POST',{},owner),201);
 assert.equal((await request(`/leads/${lead.id}/convert`,'POST',{},owner)).status,409);
});
test('server calculates invoices in minor units; rejects invalid amounts',async()=>{
 assert.deepEqual(invoiceAmounts([{quantity:2,unit_price:10001}],18),{subtotal:20002,tax:3600,total:23602});
 invoice=ok(await request('/invoices','POST',{client_id:client.id,number:'INV-001',items:[{description:'Monthly content',quantity:1,unit_price:3500000}],tax_rate:18},owner),201);
 assert.equal(invoice.total,4130000);assert.equal(invoice.paid,0);
 assert.equal((await request('/invoices','POST',{client_id:client.id,number:'INV-bad',items:[{description:'Bad',quantity:1,unit_price:-1}]},owner)).status,400);
 assert.equal((await request(`/invoices/${invoice.id}/payments`,'POST',{amount:1000},owner)).status,400);
 ok(await request(`/invoices/${invoice.id}`,'PATCH',{status:'Sent'},owner));
 assert.equal((await request(`/invoices/${invoice.id}/payments`,'POST',{amount:5000000},owner)).status,400);
 let paid=ok(await request(`/invoices/${invoice.id}/payments`,'POST',{amount:2000000,reference:'test partial'},owner),201);assert.equal(paid.status,'Part paid');assert.equal(paid.paid,2000000);
 assert.equal((await request(`/invoices/${invoice.id}`,'PATCH',{status:'Void'},owner)).status,400);
 paid=ok(await request(`/invoices/${invoice.id}/payments`,'POST',{amount:2130000},owner),201);assert.equal(paid.status,'Paid');assert.equal(paid.paid,paid.total);
 assert.equal((await request(`/invoices/${invoice.id}/payments`,'POST',{amount:1},owner)).status,400);
});
test('retainer invoicing is idempotent per billing month',async()=>{
 const r=ok(await request('/retainers','POST',{name:'Monthly reels',client_id:client.id,amount:3500000,deliverables:15,delivered:5,period:'2026-10'},owner),201);
 ok(await request(`/retainers/${r.id}/invoice`,'POST',{},owner),201);
 assert.equal((await request(`/retainers/${r.id}/invoice`,'POST',{},owner)).status,409);
 assert.equal((await request(`/retainers/${r.id}`,'PATCH',{delivered:16},owner)).status,400);
});
test('client invitation is scoped, single use, and hides private records',async()=>{
 const invitation=ok(await request('/invitations','POST',{email:client.email,role:'client',client_id:client.id},owner),201);
 const token=new URL(invitation.url).searchParams.get('invite');
 const join=await request('/auth/accept-invite','POST',{token,name:'Dr Example',password:'ClientPassword123!'});ok(join,201);portal=join.cookie;
 assert.equal((await request('/auth/accept-invite','POST',{token,name:'Duplicate',password:'ClientPassword123!'})).status,400);
 const hidden=ok(await request('/projects','POST',{name:'Internal only',client_id:client.id,shared:false},owner),201);
 const otherClient=ok(await request('/clients','POST',{name:'Other client',email:'second@example.test'},owner),201);
 const otherProject=ok(await request('/projects','POST',{name:'Other client project',client_id:otherClient.id},owner),201);
 const b=ok(await request('/bootstrap','GET',undefined,portal));assert.equal(b.projects.length,1);assert.equal(b.projects[0].id,project.id);assert.equal(b.invoices.length,1);assert.equal(b.team,undefined);
 assert.equal((await request('/clients','POST',{name:'Hack',email:'hack@example.test'},portal)).status,403);
 assert.equal((await request(`/projects/${hidden.id}/comments`,'GET',undefined,portal)).status,404);
 assert.equal((await request(`/projects/${otherProject.id}/comments`,'GET',undefined,portal)).status,404);
 assert.equal((await request('/export','GET',undefined,portal)).status,403);
});
test('client comments, delivery approval, review and document acknowledgment',async()=>{
 ok(await request(`/projects/${project.id}/comments`,'POST',{body:'Please review the October content.'},owner),201);
 ok(await request(`/projects/${project.id}/comments`,'POST',{body:'Looks good, thank you.'},portal),201);
 assert.equal(ok(await request(`/projects/${project.id}/comments`,'GET',undefined,portal)).length,2);
 assert.equal((await request(`/projects/${project.id}/approve`,'POST',{},portal)).status,400);
 ok(await request(`/projects/${project.id}`,'PATCH',{status:'In review'},owner));
 ok(await request(`/projects/${project.id}/approve`,'POST',{},portal));
 ok(await request(`/projects/${project.id}/review`,'POST',{rating:5,body:'Great work.'},portal),201);
 assert.equal((await request(`/projects/${project.id}/review`,'POST',{rating:5,body:'Duplicate'},portal)).status,409);
 const document=ok(await request('/documents','POST',{title:'Proposal',client_id:client.id,body:'Scope of work',shared:true},owner),201);
 ok(await request(`/documents/${document.id}/accept`,'POST',{},portal));
 assert.equal((await request(`/documents/${document.id}`,'PATCH',{body:'Changed terms'},owner)).status,409);
 assert.equal((await request(`/documents/${document.id}`,'DELETE',undefined,owner)).status,409);
});
test('team invitation, restricted administration, task assignment and access removal',async()=>{
 const invitation=ok(await request('/invitations','POST',{email:'editor@example.test',role:'member'},owner),201);
 const token=new URL(invitation.url).searchParams.get('invite');
 const join=await request('/auth/accept-invite','POST',{token,name:'Editor',password:'EditorPassword123!'});const u=ok(join,201).user;member=join.cookie;
 const task=ok(await request('/tasks','POST',{title:'Edit reel',project_id:project.id,assignee_id:u.id},member),201);
 ok(await request(`/tasks/${task.id}`,'PATCH',{status:'Done'},member));
 assert.equal((await request('/invitations','POST',{email:'x@example.test',role:'member'},member)).status,403);
 assert.equal((await request(`/clients/${client.id}`,'DELETE',undefined,member)).status,403);
 ok(await request(`/team/${u.id}`,'DELETE',undefined,owner));
 assert.equal((await request('/bootstrap','GET',undefined,member)).status,401);
});
test('settings, export and logout; cross-origin request denied',async()=>{
 const r=await fetch(base+'/api/clients',{method:'POST',headers:{'Content-Type':'application/json','X-Clienter-Request':'1',Origin:'https://evil.example',Cookie:owner},body:'{}'});assert.equal(r.status,403);
 const b=ok(await request('/bootstrap','GET',undefined,owner));
 assert.equal((await request('/workspace','PATCH',{name:'Medfluence',currency:'USD',address:'',tax_id:''},owner)).status,409);
 const exported=ok(await request('/export','GET',undefined,owner));assert.ok(exported.invoices.length>0);assert.equal(exported.users,undefined);assert.equal(exported.sessions,undefined);
 ok(await request('/auth/logout','POST',{},owner));assert.equal((await request('/bootstrap','GET',undefined,owner)).status,401);
});
