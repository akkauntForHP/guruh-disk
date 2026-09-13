const { getSupabase, getDriveClient } = require('./utils');
const { Readable } = require('stream');

// CORS yordamchi funksiya
const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
};

// Multipart body'dan fayllarni ajratib olish (Busboy o'rniga qo'lda parse)
const parseMultipart = (req) => {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return reject(new Error('Multipart boundary topilmadi. Content-Type: ' + contentType));
    }
    const boundary = boundaryMatch[1].trim();

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const files = [];

        // Boundary bilan ajratish
        const delimiterBuf = Buffer.from(`--${boundary}`);
        let start = 0;
        const parts = [];

        // Body'ni boundarylar bo'yicha bo'lib chiqamiz
        while (true) {
          const idx = body.indexOf(delimiterBuf, start);
          if (idx === -1) break;
          const end = body.indexOf(delimiterBuf, idx + delimiterBuf.length);
          if (end === -1) {
            parts.push(body.slice(idx + delimiterBuf.length));
            break;
          }
          parts.push(body.slice(idx + delimiterBuf.length, end));
          start = end;
        }

        for (const part of parts) {
          // \r\n--boundary-- oxirini olib tashlaymiz
          const partStr = part.toString('binary');
          const headerEnd = partStr.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;

          const headerSection = partStr.slice(0, headerEnd);
          // Header qatorlarini ajratamiz
          const headers = {};
          headerSection.split('\r\n').forEach(line => {
            const colonIdx = line.indexOf(':');
            if (colonIdx > -1) {
              headers[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
            }
          });

          const disposition = headers['content-disposition'] || '';
          if (!disposition.includes('filename')) continue;

          // Fayl nomini ajratib olamiz
          const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
          if (!filenameMatch) continue;
          const filename = decodeURIComponent(filenameMatch[1].trim());

          const mimeType = headers['content-type'] || 'application/octet-stream';

          // Fayl content'ini olamiz (binary slice)
          const contentStart = headerEnd + 4; // '\r\n\r\n' = 4 belgi
          // Oxiridagi \r\n ni olib tashlaymiz
          const rawContent = part.slice(contentStart);
          // Binary buffer sifatida olamiz
          const contentBuf = rawContent.slice(0, rawContent.length - 2); // oxirgi \r\n

          if (contentBuf.length === 0) continue;

          files.push({ filename, mimeType, buffer: contentBuf });
        }

        resolve(files);
      } catch (e) {
        reject(e);
      }
    });
  });
};

// Buffer'dan Readable stream yaratish
const bufferToStream = (buffer) => {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
};

module.exports = async (req, res) => {
  setCors(res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method } = req;
  const action = req.query.action;

  try {
    if (method === 'GET' && action === 'list') {
      const { folderId } = req.query;
      if (!folderId) return res.status(400).json({ error: 'Folder ID required' });

      const drive = getDriveClient();
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, size, webViewLink, webContentLink, createdTime)',
        orderBy: 'createdTime desc'
      });

      return res.status(200).json({ files: response.data.files });
    }

    if (method === 'POST' && action === 'delete') {
      const { fileId } = req.body;
      if (!fileId) return res.status(400).json({ error: 'File ID required' });

      const drive = getDriveClient();
      const filesToDelete = Array.isArray(fileId) ? fileId : [fileId];

      for (const id of filesToDelete) {
        await drive.files.delete({ fileId: id });
      }

      return res.status(200).json({ success: true });
    }

    if (method === 'POST' && action === 'upload') {
      const folderId = req.query.folderId;
      if (!folderId) return res.status(400).json({ error: 'Folder ID required' });

      // Fayllarni multipart'dan parse qilamiz
      let files;
      try {
        files = await parseMultipart(req);
      } catch (parseErr) {
        console.error('Multipart parse error:', parseErr);
        return res.status(400).json({ error: 'Faylni o\'qishda xatolik: ' + parseErr.message });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'Hech qanday fayl topilmadi' });
      }

      const drive = getDriveClient();
      const uploadedFiles = [];

      for (const file of files) {
        try {
          const stream = bufferToStream(file.buffer);
          const result = await drive.files.create({
            requestBody: {
              name: file.filename,
              parents: [folderId]
            },
            media: {
              mimeType: file.mimeType,
              body: stream
            },
            fields: 'id, name, webViewLink, webContentLink'
          });
          uploadedFiles.push(result.data);
        } catch (uploadErr) {
          console.error('Drive upload error for file', file.filename, ':', uploadErr);
          return res.status(500).json({ error: `"${file.filename}" faylini yuklashda xatolik: ${uploadErr.message}` });
        }
      }

      return res.status(200).json({ success: true, files: uploadedFiles });
    }

    return res.status(404).json({ error: 'Route not found' });
  } catch (err) {
    console.error('files.js error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};

// Vercel raw body config - bodyParser o'chirilishi kerak multipart uchun
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
