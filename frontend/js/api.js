const API_URL = '/api'; // Agar Netlify va Vercel alohida bo'lsa, bu yerga Vercel URL qo'yiladi (Masalan: https://guruh-disk-backend.vercel.app/api)
// Monorepo sifatida deploy qilinganda, odatda Vercel frontend va backendni birga xizmat qiladi, shuning uchun nisbiy manzil yetarli. 
// Lekin hozir xavfsizlik va aniqlik uchun, agar alohida domenlar ishlatsangiz: const API_URL = 'YOUR_VERCEL_APP_URL/api';

async function fetchUsers() {
  const res = await fetch(`${API_URL}/users?action=list`);
  if (!res.ok) throw new Error('Foydalanuvchilarni yuklashda xatolik');
  return res.json();
}

async function authenticate(userId, password) {
  const res = await fetch(`${API_URL}/users?action=auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: userId, password })
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Parol noto\'g\'ri');
  }
  return res.json();
}

async function setPassword(userId, newPassword) {
  const res = await fetch(`${API_URL}/users?action=set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: userId, newPassword })
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Parol o\'rnatishda xatolik');
  }
  return res.json();
}

async function fetchFiles(folderId) {
  const res = await fetch(`${API_URL}/files?action=list&folderId=${folderId}`);
  if (!res.ok) throw new Error('Fayllarni yuklashda xatolik');
  return res.json();
}

async function deleteFiles(fileIds) {
  const res = await fetch(`${API_URL}/files?action=delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: fileIds }) // fileId qator yoki massiv qabul qiladi
  });
  if (!res.ok) throw new Error('O\'chirishda xatolik');
  return res.json();
}

async function uploadFiles(folderId, fileList) {
  const formData = new FormData();
  for (let i = 0; i < fileList.length; i++) {
    formData.append('files', fileList[i]);
  }
  
  const res = await fetch(`${API_URL}/files?action=upload&folderId=${folderId}`, {
    method: 'POST',
    body: formData
  });
  
  if (!res.ok) throw new Error('Yuklashda xatolik');
  return res.json();
}
