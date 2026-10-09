import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from './db.js';
import { token, digest, hashPassword, verifyPassword, invoiceAmounts } from './security.js';

const text = z.string().trim().max(5000);
const short = z.string().trim().max(200);
const required = short.min(1);
const email = z.email().max(254).transform(v => v.toLowerCase());
const password = z.string().min(10).max(128);
const id = z.uuid();
const date = z.union([z.literal(''), z.iso.date()]);
const money = z.number().int().min(0).max(1_000_000_000);
const optionalEmail = z.union([z.literal(''),email]);
const schemas = {
 clients: z.object({ name:required, email, company:short.default(''), phone:short.default(''), status:z.enum(['active','paused']).default('active'), notes:text.default('') }).strict(),
 leads: z.object({ name:required, email:optionalEmail.default(''), company:short.default(''), phone:short.default(''), source:short.default('Website'), stage:z.enum(['New','Contacted','Qualified','Won','Lost']).default('New'), value:money.default(0), follow_up:date.default(''), notes:text.default('') }).strict(),
 projects: z.object({name:required, client_id:id, description:text.default(''), status:z.enum(['Planned','In progress','In review','Completed']).default('Planned'), budget:money.default(0), due_date:date.default(''), shared:z.boolean().default(true)}).strict(),
 tasks: z.object({title:required, project_id:id, status:z.enum(['To do','In progress','In review','Done']).default('To do'), priority:z.enum(['Low','Medium','High']).default('Medium'), assignee_id:id.nullable().default(null), due_date:date.default('')}).strict(),
 expenses: z.object({title:required, category:z.enum(['Production','Software','Travel','Team','Other']).default('Other'), amount:money, date:z.iso.date()}).strict(),
 retainers: z.object({name:required, client_id:id, amount:money, deliverables:z.number().int().min(1).max(10000).default(15), delivered:z.number().int().min(0).max(10000).default(0), period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), status:z.enum(['Active','Paused']).default('Active')}).strict(),
 meetings: z.object({title:required, client_id:id.nullable().default(null), starts_at:z.iso.datetime(), duration:z.number().int().min(5).max(480).default(30), location:short.default(''), notes:text.default('')}).strict(),
 documents: z.object({title:required, client_id:id, type:z.enum(['Proposal','Contract','File']).default('Proposal'), body:text.default(''), url:z.union([z.literal(''),z.url().max(2000).refine(v=>new URL(v).protocol==='https:','Use an HTTPS link')]).default(''), shared:z.boolean().default(false)}).strict()
};
const invoiceSchema = z.object({client_id:id, number:required.max(50), items:z.array(z.object({description:required, quantity:z.number().min(0.01).max(100000),unit_price:money})).min(1).max(100),tax_rate:z.number().min(0).max(100).default(0),due_date:date.default(''),notes:text.default('')}).strict();
const fail = (status,message) => {const e=new Error(message);e.status=status;throw e;};
const one = async (db,sql,params=[]) => (await db.query(sql,params)).rows[0];
const safeUser = u => ({id:u.id, name:u.name, email:u.email, role:u.role, client_id:u.client_id, workspace_id:u.workspace_id});
const publicOrigin = req => process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;

export function createApp(db) {
 const app=express();
 const production=process.env.NODE_ENV==='production';
 app.disable('x-powered-by'); app.set('trust proxy',1);
 app.use(helmet({contentSecurityPolicy:{directives:{'default-src':["'self'"],'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"],'img-src':["'self'",'data:'],'connect-src':["'self'"],'frame-ancestors':["'none'"],'upgrade-insecure-requests':production?[]:null}}}));
 app.use(express.json({limit:'150kb'}));
 app.use('/api', (req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.use('/api',rateLimit({windowMs:60_000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
 app.use('/api',(req,res,next)=>{
   if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
     if(req.get('X-Clienter-Request')!=='1') return res.status(403).json({error:'Request verification failed.'});
     const origin=req.get('origin');
     const allowed=new Set([publicOrigin(req),!production?'http://localhost:5173':null]);
     if(origin&&!allowed.has(origin))return res.status(403).json({error:'Origin not allowed.'});
   } next();
 });
 app.get('/api/health',async(req,res)=>{await db.query('SELECT 1');res.json({status:'ok'});});
 const authLimit=rateLimit({windowMs:15*60_000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
 app.use('/api/auth',authLimit);
 async function session(res,user) {
   const raw=token();
   await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
   await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[digest(raw),user.id,new Date(Date.now()+7*86400000)]);
   res.cookie('clienter_session',raw,{httpOnly:true,secure:production,sameSite:'lax',maxAge:7*86400000,path:'/'});
 }
 app.post('/api/auth/register',async(req,res)=>{
   const data=z.object({name:required,email,password,workspace:required}).strict().parse(req.body);
   const hash=await hashPassword(data.password);
   const user=await transaction(db,async q=>{
     if(await one(q,'SELECT id FROM users WHERE email=$1',[data.email]))fail(409,'This email already has an account. Sign in instead.');
     const wid=randomUUID(),uid=randomUUID();
     await q.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[wid,data.workspace]);
     return one(q,'INSERT INTO users(id,workspace_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid,wid,data.name,data.email,hash,'owner']);
   });
   await session(res,user);res.status(201).json({user:safeUser(user)});
 });
 app.post('/api/auth/login',async(req,res)=>{
   const data=z.object({email,password:z.string().max(128)}).parse(req.body);
   const user=await one(db,'SELECT * FROM users WHERE email=$1',[data.email]);
   if(!user||!await verifyPassword(data.password,user.password_hash))fail(401,'Email or password is incorrect.');
   await session(res,user);res.json({user:safeUser(user)});
 });
 app.post('/api/auth/accept-invite',async(req,res)=>{
   const data=z.object({token:z.string().length(64),name:required,password}).strict().parse(req.body);
   const hash=await hashPassword(data.password);
   const user=await transaction(db,async q=>{
     const invite=await one(q,'SELECT * FROM invitations WHERE token_hash=$1 AND used=FALSE AND expires_at>NOW() FOR UPDATE',[digest(data.token)]);
     if(!invite)fail(400,'Invitation expired or already used. Ask for a new invitation.');
     if(await one(q,'SELECT id FROM users WHERE email=$1',[invite.email]))fail(409,'An account already exists for this email.');
     await q.query('UPDATE invitations SET used=TRUE WHERE id=$1',[invite.id]);
     return one(q,'INSERT INTO users(id,workspace_id,name,email,password_hash,role,client_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),invite.workspace_id,data.name,invite.email,hash,invite.role,invite.client_id]);
   });await session(res,user);res.status(201).json({user:safeUser(user)});
 });
 app.use('/api',async(req,res,next)=>{
   const raw=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('clienter_session='))?.slice(17);
   if(!raw) return res.status(401).json({error:'Please sign in.'});
   const user=await one(db,'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',[digest(raw)]);
   if(!user)return res.status(401).json({error:'Session expired. Please sign in.'});
   req.user=user;req.sessionHash=digest(raw);next();
 });
 app.get('/api/auth/me',(req,res)=>res.json({user:safeUser(req.user)}));
 app.post('/api/auth/logout',async(req,res)=>{await db.query('DELETE FROM sessions WHERE token_hash=$1',[req.sessionHash]);res.clearCookie('clienter_session',{path:'/'});res.json({ok:true});});
 app.post('/api/auth/password',async(req,res)=>{
   const data=z.object({current:z.string().max(128),password}).parse(req.body);
   if(!await verifyPassword(data.current,req.user.password_hash))fail(400,'Current password is incorrect.');
   await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword(data.password),req.user.id]);
   await db.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);await session(res,req.user);res.json({ok:true});
 });
 const staff=(req,res,next)=>req.user.role==='client'?res.status(403).json({error:'Staff access required.'}):next();
 const owner=(req,res,next)=>req.user.role!=='owner'?res.status(403).json({error:'Owner access required.'}):next();
 async function owned(q,table,recordId,user) {
   const row=await one(q,`SELECT * FROM ${table} WHERE id=$1 AND workspace_id=$2`,[recordId,user.workspace_id]);
   if(!row)fail(404,'Record not found.');return row;
 }
 async function references(q,data,user) {
   if(data.client_id)await owned(q,'clients',data.client_id,user);
   if(data.project_id)await owned(q,'projects',data.project_id,user);
   if(data.assignee_id){const u=await owned(q,'users',data.assignee_id,user);if(u.role==='client')fail(400,'Assign tasks to a team member.');}
 }
 async function insert(q,table,data,wid) {
   const record={id:randomUUID(),workspace_id:wid,...data};
   const keys=Object.keys(record);
   return one(q,`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(record));
 }
 async function projectAccess(q,projectId,user) {
   const p=await owned(q,'projects',projectId,user);
   if(user.role==='client'&&(!p.shared||p.client_id!==user.client_id))fail(404,'Project not found.');return p;
 }
 app.get('/api/bootstrap',async(req,res)=>{
   const u=req.user,wid=u.workspace_id;
   const workspace=await one(db,'SELECT * FROM workspaces WHERE id=$1',[wid]);
   const data={user:safeUser(u),workspace,demo:process.env.DEMO_MODE==='true'&&!process.env.DATABASE_URL};
   if(u.role==='client') {
     for(const table of ['projects','invoices','meetings','documents','reviews']) {
       let condition=table==='projects'||table==='documents'?' AND shared=TRUE':table==='invoices'?" AND status!='Draft'":'';
       data[table]=(await db.query(`SELECT * FROM ${table} WHERE workspace_id=$1 AND client_id=$2${condition} ORDER BY created_at DESC`,[wid,u.client_id])).rows;
     }
     data.clients=[await owned(db,'clients',u.client_id,u)];
   } else {
     for(const table of [...Object.keys(schemas),'invoices','payments','reviews'])data[table]=(await db.query(`SELECT * FROM ${table} WHERE workspace_id=$1 ORDER BY created_at DESC`,[wid])).rows;
     data.team=(await db.query("SELECT id,name,email,role,client_id,created_at FROM users WHERE workspace_id=$1 AND role!='client' ORDER BY created_at",[wid])).rows;
     if(u.role==='owner')data.invitations=(await db.query('SELECT id,email,role,used,expires_at FROM invitations WHERE workspace_id=$1 ORDER BY expires_at DESC',[wid])).rows;
   }
   res.json(data);
 });
 for(const [table,schema] of Object.entries(schemas)) {
   app.post(`/api/${table}`,staff,async(req,res)=>{
     const data=schema.parse(req.body);await references(db,data,req.user);
     if(table==='retainers'&&data.delivered>data.deliverables)fail(400,'Delivered count cannot exceed the target.');
     res.status(201).json(await insert(db,table,data,req.user.workspace_id));
   });
   app.patch(`/api/${table}/:id`,staff,async(req,res)=>{
     id.parse(req.params.id);const data=schema.partial().parse(req.body);
     if(!Object.keys(data).length)fail(400,'No changes supplied.');
     const old=await owned(db,table,req.params.id,req.user);await references(db,data,req.user);
     if(table==='documents'&&old.accepted_at)fail(409,'Accepted documents are locked. Create a new document for revisions.');
     if(table==='projects'&&data.client_id&&data.client_id!==old.client_id)fail(400,'Create a new project to change its client.');
     if(table==='retainers'&&({...old,...data}).delivered>({...old,...data}).deliverables)fail(400,'Delivered count cannot exceed the target.');
     const keys=Object.keys(data);
     res.json(await one(db,`UPDATE ${table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} AND workspace_id=$${keys.length+2} RETURNING *`,[...Object.values(data),req.params.id,req.user.workspace_id]));
   });
   app.delete(`/api/${table}/:id`,owner,async(req,res)=>{
     id.parse(req.params.id);const row=await owned(db,table,req.params.id,req.user);
     if(table==='documents'&&row.accepted_at)fail(409,'Accepted documents cannot be deleted.');
     await db.query(`DELETE FROM ${table} WHERE id=$1 AND workspace_id=$2`,[req.params.id,req.user.workspace_id]);res.json({ok:true});
   });
 }
 app.post('/api/leads/:id/convert',staff,async(req,res)=>{
   const result=await transaction(db,async q=>{
     const lead=await one(q,'SELECT * FROM leads WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[req.params.id,req.user.workspace_id]);
     if(!lead)fail(404,'Lead not found.');
     if(lead.converted_client_id)fail(409,'This lead has already been converted.');
     if(!lead.email)fail(400,'Add an email address before converting this lead.');
     const client=await insert(q,'clients',{name:lead.name,email:lead.email,company:lead.company,phone:lead.phone,notes:lead.notes},req.user.workspace_id);
     await q.query("UPDATE leads SET stage='Won',converted_client_id=$1 WHERE id=$2",[client.id,lead.id]);return client;
   });res.status(201).json(result);
 });
 async function createInvoice(q,data,wid) {
   const totals=invoiceAmounts(data.items,data.tax_rate);
   return insert(q,'invoices',{...data,items:JSON.stringify(data.items),...totals},wid);
 }
 app.post('/api/invoices',staff,async(req,res)=>{
   const data=invoiceSchema.parse(req.body);await references(db,data,req.user);
   res.status(201).json(await createInvoice(db,data,req.user.workspace_id));
 });
 app.patch('/api/invoices/:id',staff,async(req,res)=>{
   const data=z.object({status:z.enum(['Sent','Void'])}).strict().parse(req.body);
   const result=await transaction(db,async q=>{
     const row=await one(q,'SELECT * FROM invoices WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[req.params.id,req.user.workspace_id]);
     if(!row)fail(404,'Invoice not found.');
     if(data.status==='Sent'&&row.status!=='Draft')fail(400,'Only draft invoices can be issued.');
     if(data.status==='Void'&&(row.paid>0||row.status==='Void'))fail(400,'An invoice with payments cannot be voided.');
     return one(q,'UPDATE invoices SET status=$1 WHERE id=$2 RETURNING *',[data.status,row.id]);
   });res.json(result);
 });
 app.post('/api/invoices/:id/payments',staff,async(req,res)=>{
   const data=z.object({amount:money.min(1),reference:short.default('')}).strict().parse(req.body);
   const result=await transaction(db,async q=>{
     const inv=await one(q,'SELECT * FROM invoices WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[req.params.id,req.user.workspace_id]);
     if(!inv)fail(404,'Invoice not found.');
     if(!['Sent','Part paid'].includes(inv.status))fail(400,'Issue the invoice before recording payment.');
     if(data.amount>inv.total-inv.paid)fail(400,'Payment exceeds the outstanding amount.');
     const paid=inv.paid+data.amount;
     await insert(q,'payments',{invoice_id:inv.id,...data},req.user.workspace_id);
     return one(q,'UPDATE invoices SET paid=$1,status=$2 WHERE id=$3 RETURNING *',[paid,paid===inv.total?'Paid':'Part paid',inv.id]);
   });res.status(201).json(result);
 });
 app.post('/api/retainers/:id/invoice',staff,async(req,res)=>{
   const result=await transaction(db,async q=>{
     const r=await one(q,'SELECT * FROM retainers WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[req.params.id,req.user.workspace_id]);
     if(!r)fail(404,'Retainer not found.');
     if(r.status!=='Active')fail(400,'Activate the retainer before invoicing.');
     if(await one(q,'SELECT invoice_id FROM retainer_invoices WHERE retainer_id=$1 AND period=$2',[r.id,r.period]))fail(409,'This retainer period has already been invoiced.');
     const inv=await createInvoice(q,{client_id:r.client_id,number:`RET-${r.period}-${r.id.slice(0,8)}`,items:[{description:`${r.name} · ${r.period}`,quantity:1,unit_price:r.amount}],tax_rate:0,due_date:'',notes:'Monthly retainer'},req.user.workspace_id);
     await q.query('INSERT INTO retainer_invoices(retainer_id,period,invoice_id) VALUES($1,$2,$3)',[r.id,r.period,inv.id]);return inv;
   });res.status(201).json(result);
 });
 app.post('/api/invitations',owner,async(req,res)=>{
   const data=z.object({email,role:z.enum(['member','client']),client_id:id.nullable().default(null)}).strict().parse(req.body);
   if(data.role==='client'){
     if(!data.client_id)fail(400,'Select a client.');
     const c=await owned(db,'clients',data.client_id,req.user);
     if(c.email.toLowerCase()!==data.email)fail(400,'Invitation email must match the client email.');
   }else data.client_id=null;
   if(await one(db,'SELECT id FROM users WHERE email=$1',[data.email]))fail(409,'This email already has an account.');
   const raw=token();
   await db.query('UPDATE invitations SET used=TRUE WHERE workspace_id=$1 AND email=$2',[req.user.workspace_id,data.email]);
   await insert(db,'invitations',{...data,token_hash:digest(raw),expires_at:new Date(Date.now()+48*3600000)},req.user.workspace_id);
   res.status(201).json({url:`${publicOrigin(req)}/?invite=${raw}`,expires_in_hours:48});
 });
 app.delete('/api/invitations/:id',owner,async(req,res)=>{
   await owned(db,'invitations',req.params.id,req.user);
   await db.query('UPDATE invitations SET used=TRUE WHERE id=$1',[req.params.id]);res.json({ok:true});
 });
 app.delete('/api/team/:id',owner,async(req,res)=>{
   const member=await owned(db,'users',req.params.id,req.user);
   if(member.role==='owner')fail(400,'The workspace owner cannot be removed.');
   await transaction(db,async q=>{
     await q.query('DELETE FROM sessions WHERE user_id=$1',[member.id]);
     // Preserve comment authorship while disabling the old login and freeing the email for a new invitation.
     await q.query('UPDATE users SET email=$1,password_hash=$2 WHERE id=$3',[`removed-${member.id}@disabled.invalid`,await hashPassword(token()),member.id]);
   });res.json({ok:true});
 });
 app.patch('/api/workspace',owner,async(req,res)=>{
   const data=z.object({name:required,currency:z.enum(['INR','USD','EUR','GBP']),address:text,tax_id:short}).strict().parse(req.body);
   const w=await one(db,'SELECT * FROM workspaces WHERE id=$1',[req.user.workspace_id]);
   if(data.currency!==w.currency){
     for(const table of ['invoices','expenses','retainers','leads','projects'])if(await one(db,`SELECT id FROM ${table} WHERE workspace_id=$1 LIMIT 1`,[w.id]))fail(409,'Currency is locked once financial records exist.');
   }
   res.json(await one(db,'UPDATE workspaces SET name=$1,currency=$2,address=$3,tax_id=$4 WHERE id=$5 RETURNING *',[data.name,data.currency,data.address,data.tax_id,w.id]));
 });
 app.get('/api/projects/:id/comments',async(req,res)=>{
   await projectAccess(db,req.params.id,req.user);
   res.json((await db.query('SELECT c.*,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=$1 AND c.workspace_id=$2 ORDER BY c.created_at',[req.params.id,req.user.workspace_id])).rows);
 });
 app.post('/api/projects/:id/comments',async(req,res)=>{
   await projectAccess(db,req.params.id,req.user);const data=z.object({body:text.min(1)}).strict().parse(req.body);
   res.status(201).json(await insert(db,'comments',{project_id:req.params.id,user_id:req.user.id,...data},req.user.workspace_id));
 });
 app.post('/api/projects/:id/approve',async(req,res)=>{
   if(req.user.role!=='client')fail(403,'Only the client can approve delivery.');
   const p=await projectAccess(db,req.params.id,req.user);
   if(p.status!=='In review')fail(400,'Project must be in review before approval.');
   await db.query("UPDATE projects SET status='Completed' WHERE id=$1",[p.id]);
   await insert(db,'comments',{project_id:p.id,user_id:req.user.id,body:'Approved the project delivery.'},req.user.workspace_id);res.json({ok:true});
 });
 app.post('/api/projects/:id/review',async(req,res)=>{
   if(req.user.role!=='client')fail(403,'Only clients can submit reviews.');
   const p=await projectAccess(db,req.params.id,req.user);if(p.status!=='Completed')fail(400,'Complete the project before reviewing.');
   const data=z.object({rating:z.number().int().min(1).max(5),body:text.min(1)}).strict().parse(req.body);
   res.status(201).json(await insert(db,'reviews',{project_id:p.id,client_id:req.user.client_id,...data},req.user.workspace_id));
 });
 app.post('/api/documents/:id/accept',async(req,res)=>{
   if(req.user.role!=='client')fail(403,'Only clients can acknowledge documents.');
   const d=await owned(db,'documents',req.params.id,req.user);
   if(!d.shared||d.client_id!==req.user.client_id)fail(404,'Document not found.');
   if(d.accepted_at)fail(409,'Document already acknowledged.');
   await db.query('UPDATE documents SET accepted_by=$1,accepted_at=NOW() WHERE id=$2',[req.user.name,d.id]);res.json({ok:true});
 });
 app.get('/api/export',owner,async(req,res)=>{
   const out={exported_at:new Date().toISOString(),workspace:await one(db,'SELECT * FROM workspaces WHERE id=$1',[req.user.workspace_id])};
   for(const table of [...Object.keys(schemas),'invoices','payments','comments','reviews'])out[table]=(await db.query(`SELECT * FROM ${table} WHERE workspace_id=$1`,[req.user.workspace_id])).rows;
   res.attachment('clienter-export.json').json(out);
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found.'}));
 const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
 app.use(express.static(dist));
 app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));
 app.use((error,req,res,next)=>{
   if(error instanceof ZodError)return res.status(400).json({error:error.issues.map(v=>`${v.path.join('.')}: ${v.message}`).join('; ')});
   if(error.code==='23505')return res.status(409).json({error:'This record already exists. Use a unique email or invoice number.'});
   if(error.code==='23503')return res.status(409).json({error:'This record has related work. Remove related records first, or keep it archived.'});
   if(error.status)return res.status(error.status).json({error:error.message});
   console.error('Request failed:',error.message);res.status(500).json({error:'Something went wrong. Please try again.'});
 });
 return app;
}
