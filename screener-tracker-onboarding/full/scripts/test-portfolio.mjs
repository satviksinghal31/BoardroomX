import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
// Generate a magic-link-style session for the dev user via admin API
const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: 'satviksinghal31@gmail.com',
});
console.log('generateLink:', error?.message ?? 'OK');
// That doesn't return a session directly. Better: sign-in with the test user we
// created via UI (we know its password): qatest.bx.20260522a@mailinator.com
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
const { data: sess, error: signErr } = await anon.auth.signInWithPassword({
  email:    'qatest.bx.20260522a@mailinator.com',
  password: 'QATest123!@#secure',
});
if (signErr) { console.error('sign-in:', signErr.message); process.exit(1); }
console.log('access token (first 30):', sess.session.access_token.slice(0,30));
console.log('test user id:', sess.user.id);
process.stdout.write(sess.session.access_token + '\n');
