import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const TRY = ['NESTLEIND', 'HINDPETRO', 'HEROMOTOCO', 'EICHERMOT', 'INDUSINDBK'];
for (const sym of TRY) {
  const { data } = await sb.from('stocks').select('symbol').eq('symbol', sym).maybeSingle();
  if (!data) { console.log('UNCATALOGED:', sym); process.exit(0); }
  const { data: f } = await sb.from('financials').select('fetched_at').eq('symbol', sym).maybeSingle();
  if (!f?.fetched_at) { console.log('STUB:', sym); process.exit(0); }
}
console.log('ALL_CATALOGED');
