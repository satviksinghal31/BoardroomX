import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerAuthRoutes } from './auth_routes.js';

export function createApp({admin, auth}) {
 const app = express();
 app.disable('x-powered-by');
 app.use(express.json({limit: '32kb'}));
 app.get('/health', (_req,res) => res.json({ok:true,stage:'cleanup'}));
 registerAuthRoutes(app, admin, auth);
 app.use('/api', (_req,res) => res.status(404).json({error:'Not found'}));
 app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
 app.use((_req,res) => res.status(404).json({error:'Not found'}));
 app.use((err,_req,res,_next) => res.status(err.status || 500).json({error: err.status === 400 ? 'Invalid request' : 'Internal server error'}));
 return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 for (const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
 }
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
 const auth=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,options);
 createApp({admin,auth}).listen(process.env.PORT || 3001,()=>console.log('BoardroomX cleanup server listening'));
}
