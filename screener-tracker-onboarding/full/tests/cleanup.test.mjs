import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
const admin = { auth: { getUser: async () => ({data: {user: {id:'user',email:'user@example.com'}}}) } };
test('clean server keeps auth and health while removed scrape routes return JSON 404', {timeout:10000}, async () => {
 const app = createApp({admin, auth: {auth: {}}});
 const server = app.listen(0, '127.0.0.1');
 await new Promise((resolve,reject) => {server.once('listening', resolve);server.once('error',reject)});
 try {
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/health')).status,200);
  assert.equal((await fetch(url+'/api/auth/me')).status,401);
  const invalidSignIn=await fetch(url+'/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(invalidSignIn.status,400);
  const authHtml=await (await fetch(url+'/auth.html')).text();
  assert.match(authHtml,/auth.js/); assert.doesNotMatch(authHtml,/href="style.css"/);
  assert.equal((await fetch(url+'/auth.css')).status,200);
  for (const path of ['/api/annuals/status','/api/financials/LAURUSLABS','/api/scheduler/log','/api/refresh/LAURUSLABS']) {
   const response=await fetch(url+path); assert.equal(response.status,404); assert.equal((await response.json()).error,'Not found');
  }
  const home=await (await fetch(url)).text(); assert.match(home,/Cleanup complete/); assert.doesNotMatch(home,/app\.js|annuals\.js/);
 } finally { await new Promise(resolve=>server.close(resolve)); }
});
