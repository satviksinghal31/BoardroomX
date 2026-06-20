import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
const { data: sess, error } = await anon.auth.signInWithPassword({
  email: process.argv[2], password: process.argv[3],
});
if (error) { console.error(error.message); process.exit(1); }
process.stdout.write(sess.session.access_token);
