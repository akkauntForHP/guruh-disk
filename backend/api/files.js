const { supabase, getDriveClient } = require('./utils');
const Busboy = require('busboy');
const { PassThrough } = require('stream');

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
      const { fileId } = req.body; // Array of fileIds or single
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

      const busboy = Busboy({ headers: req.headers });
      const drive = getDriveClient();
      const uploads = [];

      busboy.on('file', (fieldname, file, info) => {
        const { filename, mimeType } = info;
        
        // Vercel serverless request stream is piped to Google Drive API
        const passThrough = new PassThrough();
        file.pipe(passThrough);

        const uploadPromise = drive.files.create({
          requestBody: {
            name: filename,
            parents: [folderId]
          },
          media: {
            mimeType: mimeType,
            body: passThrough
          },
          fields: 'id, name, webViewLink, webContentLink'
        });

        uploads.push(uploadPromise);
      });

      busboy.on('finish', async () => {
        try {
          const results = await Promise.all(uploads);
          const uploadedFiles = results.map(r => r.data);
          res.status(200).json({ success: true, files: uploadedFiles });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });

      // https://vercel.com/docs/concepts/functions/serverless-functions/supported-languages#node.js-request-and-response-objects
      req.pipe(busboy);
      return; // Do not send response yet, busboy will handle it
    }

    return res.status(404).json({ error: 'Route not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};

// Vercel raw body config for Busboy parsing
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
