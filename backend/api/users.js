const { supabase, getDriveClient } = require('./utils');
const bcrypt = require('bcryptjs');

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
  const path = req.query.path || ''; // ?path=list or ?path=auth or ?path=set-password

  try {
    if (method === 'GET' && req.query.action === 'list') {
      const { data: users, error } = await supabase
        .from('users')
        .select('id, name, password_hash, drive_folder_id')
        .order('id', { ascending: true });

      if (error) throw error;

      // Xavfsizlik uchun parolni jo'natmaymiz, faqat "hasPassword" degan flag yuboramiz
      const safeUsers = users.map(u => ({
        id: u.id,
        name: u.name,
        hasPassword: !!u.password_hash,
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

    if (method === 'POST' && req.query.action === 'auth') {
      const { id, password } = req.body;
      const { data: user, error } = await supabase.from('users').select('*').eq('id', id).single();
      
      if (error || !user) return res.status(404).json({ error: 'User not found' });
      if (!user.password_hash) return res.status(400).json({ error: 'Password not set' });

      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) return res.status(401).json({ error: 'Incorrect password' });

      // Agar papkasi yo'q bo'lsa, yaratamiz
      let folderId = user.drive_folder_id;
      if (!folderId) {
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
      }

      return res.status(200).json({ success: true, folderId });
    }

    if (method === 'POST' && req.query.action === 'set-password') {
      const { id, newPassword } = req.body;
      const { data: user, error } = await supabase.from('users').select('*').eq('id', id).single();

      if (error || !user) return res.status(404).json({ error: 'User not found' });
      if (user.password_hash) return res.status(400).json({ error: 'Password already set' });

      const hash = await bcrypt.hash(newPassword, 10);
      await supabase.from('users').update({ password_hash: hash }).eq('id', id);

      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Route not found' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
