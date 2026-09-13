const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

// Supabase ulanishi
const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("XATOLIK: SUPABASE_URL yoki SUPABASE_ANON_KEY topilmadi! Vercel Environment Variables'ni tekshiring.");
  }
  
  return createClient(supabaseUrl, supabaseKey);
};

// Google Drive ulanishi
const getDriveClient = () => {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error("XATOLIK: GOOGLE_CLIENT_EMAIL yoki GOOGLE_PRIVATE_KEY topilmadi!");
  }

  // Vercel env larda ko'pincha qo'shtirnoq bilan string kirib qoladi, shuni tozalaymiz
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, '\n');

  const credentials = {
    client_email: email,
    private_key: privateKey,
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
};

module.exports = { getSupabase, getDriveClient };
