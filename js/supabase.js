import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// PASTE YOUR NEW SUPABASE VALUES HERE
export const SUPABASE_URL = 'https://urnubaztswcfzotrmvgk.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_nmGzFWCbSaWto5BNnF03RA_xeov65xZ';

if (!SUPABASE_URL.startsWith('http')) {
  console.warn('Configure js/supabase.js before running GMRCRIX.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
