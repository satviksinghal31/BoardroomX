import 'dotenv/config';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createApp() {
 const app = express();
 app.disable('x-powered-by');
 app.use(express.json({limit: '32kb'}));
 app.get('/health', (_req,res) => res.json({ok:true,stage:'cleanup'}));
 app.use('/api', (_req,res) => res.status(404).json({error:'Not found'}));
 app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
 app.use((_req,res) => res.status(404).json({error:'Not found'}));
 app.use((err,_req,res,_next) => res.status(err.status || 500).json({error: err.status === 400 ? 'Invalid request' : 'Internal server error'}));
 return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 createApp().listen(process.env.PORT || 3001,()=>console.log('BoardroomX cleanup server listening'));
}
