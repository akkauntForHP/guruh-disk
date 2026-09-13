const { getSupabase, getDriveClient } = require('./utils');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method } = req;

  try {
    // API holatini tekshirish uchun (DEBUG)
    if (method === 'GET' && req.query.action === 'ping') {
      return res.status(200).json({ status: 'ok', message: 'API is working!' });
    }

    // DIAGNOSTIKA: Vercel env va Supabase ulanishini to'liq tekshirish
    if (method === 'GET' && req.query.action === 'debug') {
      const url = process.env.SUPABASE_URL || '(TOPILMADI!)';
      const key = process.env.SUPABASE_ANON_KEY || '(TOPILMADI!)';
      const gEmail = process.env.GOOGLE_CLIENT_EMAIL || '(TOPILMADI!)';
      const gKey = process.env.GOOGLE_PRIVATE_KEY ? 'MAVJUD (' + process.env.GOOGLE_PRIVATE_KEY.length + ' belgi)' : '(TOPILMADI!)';
      const rootFolder = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '(TOPILMADI!)';
      const botToken = process.env.TELEGRAM_BOT_TOKEN ? 'MAVJUD' : '(TOPILMADI!)';

      // Supabase ulanishni sinab ko'ramiz
      let supabaseTest = 'Tekshirilmadi';
      try {
        const { createClient } = require('@supabase/supabase-js');
        const testClient = createClient(url, key);
        const { data, error } = await testClient.from('users').select('id').limit(1);
        if (error) {
          supabaseTest = 'XATO: ' + error.message + ' (code: ' + error.code + ', hint: ' + (error.hint || 'yoq') + ')';
        } else {
          supabaseTest = 'OK! ' + (data ? data.length : 0) + ' ta natija qaytdi';
        }
      } catch (e) {
        supabaseTest = 'CRASH: ' + e.message;
      }

      return res.status(200).json({
        envVars: {
          SUPABASE_URL: url,
          SUPABASE_ANON_KEY_BOSHI: key.substring(0, 20) + '...',
          SUPABASE_ANON_KEY_OXIRI: '...' + key.substring(key.length - 20),
          SUPABASE_ANON_KEY_UZUNLIGI: key.length,
          GOOGLE_CLIENT_EMAIL: gEmail,
          GOOGLE_PRIVATE_KEY: gKey,
          GOOGLE_DRIVE_ROOT_FOLDER_ID: rootFolder,
          TELEGRAM_BOT_TOKEN: botToken
        },
        supabaseConnectionTest: supabaseTest
      });
    }

    const supabase = getSupabase();

    // === FOYDALANUVCHILAR RO'YXATI ===
    if (method === 'GET' && req.query.action === 'list') {
      const { data: users, error } = await supabase
        .from('users')
        .select('id, name, password, drive_folder_id')
        .order('id', { ascending: true });

      if (error) throw error;

      // Xavfsizlik uchun parolni jo'natmaymiz, faqat "hasPassword" degan flag yuboramiz
      const safeUsers = users.map(u => ({
        id: u.id,
        name: u.name,
        hasPassword: !!u.password,
        hasFolder: !!u.drive_folder_id
      }));

      // Disk xotirasini hisoblash
      const drive = getDriveClient();
      let driveAbout = { usage: 0, limit: 15 * 1024 * 1024 * 1024 }; // Default 15 GB
      try {
        const about = await drive.about.get({ fields: 'storageQuota' });
        driveAbout = about.data.storageQuota;
      } catch (err) {
        console.error('Drive API error:', err);
      }

      return res.status(200).json({ users: safeUsers, driveStorage: driveAbout });
    }

    // === AUTENTIFIKATSIYA (parol tekshirish) ===
    if (method === 'POST' && req.query.action === 'auth') {
      const { id, password } = req.body;
      
      if (!id || !password) {
        return res.status(400).json({ error: 'ID va parol kiritilishi shart' });
      }

      const { data: user, error } = await supabase.from('users').select('*').eq('id', id).single();

      if (error || !user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
      
      if (!user.password) {
        return res.status(400).json({ error: 'Parol hali o\'rnatilmagan. Avval parol o\'rnating.' });
      }

      // Oddiy parol solishtirish (bcrypt emas)
      if (password !== user.password) {
        return res.status(401).json({ error: 'Parol noto\'g\'ri' });
      }

      // Agar papkasi yo'q bo'lsa, yaratamiz
      let folderId = user.drive_folder_id;
      if (!folderId) {
        try {
          const drive = getDriveClient();
          const folder = await drive.files.create({
            requestBody: {
              name: user.name,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID]
            },
            fields: 'id'
          });
          folderId = folder.data.id;
          await supabase.from('users').update({ drive_folder_id: folderId }).eq('id', user.id);
        } catch (driveErr) {
          console.error('Drive folder creation error:', driveErr);
          return res.status(500).json({ error: 'Google Drive papka yaratishda xatolik: ' + driveErr.message });
        }
      }

      return res.status(200).json({ success: true, folderId });
    }

    // === PAROL O'RNATISH (birinchi marta) ===
    if (method === 'POST' && req.query.action === 'set-password') {
      const { id, newPassword } = req.body;
      
      if (!id || !newPassword) {
        return res.status(400).json({ error: 'ID va yangi parol kiritilishi shart' });
      }

      const { data: user, error } = await supabase.from('users').select('*').eq('id', id).single();

      if (error || !user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
      if (user.password) return res.status(400).json({ error: 'Parol allaqachon o\'rnatilgan' });

      // Parolni oddiy text sifatida saqlaymiz (bcrypt emas)
      const { error: updateError } = await supabase.from('users').update({ password: newPassword }).eq('id', id);
      
      if (updateError) {
        console.error('Password update error:', updateError);
        return res.status(500).json({ error: 'Parolni saqlashda xatolik: ' + updateError.message });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Route not found' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
