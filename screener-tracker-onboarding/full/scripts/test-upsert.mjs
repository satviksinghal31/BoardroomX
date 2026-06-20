import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await sb.from('stocks').upsert({
  symbol: 'INFY_TEST', name: 'Infosys Test',
  screener_url: 'https://www.screener.in/company/INFY/',
  is_consolidated: false, is_banking: false,
});
console.log('upsert:', error ? `ERROR: ${error.message}` : 'OK');
await sb.from('stocks').delete().eq('symbol', 'INFY_TEST');
