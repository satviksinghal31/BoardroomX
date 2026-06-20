import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
console.log('URL:', env.SUPABASE_URL);
console.log('Key prefix:', env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 12));
console.log('Key length:', env.SUPABASE_SERVICE_ROLE_KEY.length);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const tests = [
  ['watchlists', sb.from('watchlists').select('user_id').limit(3)],
  ['stocks',     sb.from('stocks').select('symbol').limit(3)],
  ['profiles',   sb.from('profiles').select('id').limit(3)],
];
for (const [name, q] of tests) {
  const { data, error } = await q;
  console.log(name+':', error ? `ERROR: ${error.message}` : `OK (${data.length} rows)`);
}
