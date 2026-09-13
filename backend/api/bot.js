const { Telegraf } = require('telegraf');
const { getSupabase, getDriveClient } = require('./utils');

let bot = null;

// Botni init qilish
const getBot = () => {
  if (!bot) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error("XATOLIK: TELEGRAM_BOT_TOKEN topilmadi!");
    }
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    setupBotLogic(bot);
  }
  return bot;
};

const setupBotLogic = (bot) => {
  // Sessiyani olish yoki yaratish
  const getSession = async (chatId) => {
    const supabase = getSupabase();
    let { data, error } = await supabase.from('bot_sessions').select('*').eq('chat_id', chatId).single();
    if (error || !data) {
      const { data: newData } = await supabase.from('bot_sessions').insert({ chat_id: chatId, step: 'idle' }).select().single();
      return newData;
    }
    return data;
  };

  // Sessiyani yangilash
  const updateSession = async (chatId, updates) => {
    const supabase = getSupabase();
    await supabase.from('bot_sessions').update({ ...updates, last_updated: new Date() }).eq('chat_id', chatId);
  };

  // Fayllar ro'yxatini yuborish funksiyasi
  const sendFilesList = async (ctx, user) => {
    const drive = getDriveClient();
    
    // Agar papkasi yo'q bo'lsa, yaratamiz
    let folderId = user.drive_folder_id;
    if (!folderId) {
      try {
        const folder = await drive.files.create({
          requestBody: {
            name: user.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID]
          },
          fields: 'id'
        });
        folderId = folder.data.id;
        const supabase = getSupabase();
        await supabase.from('users').update({ drive_folder_id: folderId }).eq('id', user.id);
      } catch (driveErr) {
        console.error('Drive folder creation error:', driveErr);
        return ctx.reply("Google Drive papka yaratishda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.");
      }
    }

    try {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, webContentLink)',
        orderBy: 'createdTime desc'
      });

      const files = response.data.files || [];
      if (files.length === 0) {
        return ctx.reply("📂 Papkangiz hozircha bo'sh.\n\nFayl yuklash uchun menga shunchaki fayl jo'nating!\n\nBoshqa papkaga o'tish: /start");
      }

      let msg = "📁 Fayllaringiz:\n\n";
      files.forEach((f, i) => {
        msg += `${i + 1}. ${f.name}\n`;
      });
      msg += "\n📥 Yuklab olish uchun fayl raqamini jo'nating";
      msg += "\n🗑 O'chirish rejimi: 0 ni jo'nating";
      msg += "\n📤 Fayl yuklash uchun menga fayl jo'nating";
      msg += "\n🔄 Boshqa papka: /start";
      
      return ctx.reply(msg);
    } catch (driveErr) {
      console.error('Drive list error:', driveErr);
      return ctx.reply("Fayllarni yuklashda xatolik yuz berdi.");
    }
  };

  // Start komandasi
  bot.start(async (ctx) => {
    try {
      const supabase = getSupabase();
      await updateSession(ctx.chat.id, { step: 'idle', selected_user_id: null });
      const { data: users, error } = await supabase.from('users').select('id, name').order('id', { ascending: true });

      if (error) {
        return ctx.reply("Bazada xatolik yuz berdi: " + error.message);
      }

      if (!users || users.length === 0) {
        return ctx.reply("Talabalar ro'yxati bo'sh. Iltimos bazani tekshiring.");
      }

      let msg = "👋 Salom! Guruh papkangizni tanlang (raqamni yuboring):\n\n";
      users.forEach((u, i) => {
        msg += `${i + 1}. ${u.name}\n`;
      });

      await ctx.reply(msg);
    } catch (e) {
      console.error(e);
      await ctx.reply("Tizimda xatolik yuz berdi.");
    }
  });

  // Xabarlarni eshitish
  bot.on('text', async (ctx) => {
    try {
      const supabase = getSupabase();
      const chatId = ctx.chat.id;
      const text = ctx.message.text.trim();
      const session = await getSession(chatId);

      // IDLE: Talaba o'z raqamini jo'natadi
      if (session.step === 'idle') {
        const index = parseInt(text) - 1;
        const { data: users } = await supabase.from('users').select('id, name, password').order('id', { ascending: true });
        
        if (isNaN(index) || index < 0 || !users || index >= users.length) {
          return ctx.reply("Iltimos, to'g'ri raqam kiriting.");
        }
        
        const user = users[index];
        
        // Agar parol o'rnatilmagan bo'lsa, to'g'ridan-to'g'ri papkaga kiritamiz
        if (!user.password) {
          await updateSession(chatId, { step: 'authenticated', selected_user_id: user.id });
          
          // Foydalanuvchining to'liq ma'lumotini olish
          const { data: fullUser } = await supabase.from('users').select('*').eq('id', user.id).single();
          return await sendFilesList(ctx, fullUser);
        }
        
        await updateSession(chatId, { step: 'waiting_password', selected_user_id: user.id });
        return ctx.reply(`🔐 Siz "${user.name}" papkasini tanladingiz.\n\nIltimos, parolingizni kiriting:`);
      }

      // WAITING_PASSWORD: Parol kiritish
      if (session.step === 'waiting_password') {
        // Parolni xavfsizlik uchun chatdan o'chiramiz
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (e) {
          console.log('Message delete failed', e.message);
        }

        const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
        
        if (!user) {
          await updateSession(chatId, { step: 'idle', selected_user_id: null });
          return ctx.reply("Foydalanuvchi topilmadi. /start bosing.");
        }

        if (!user.password) {
          // Parol yo'q — to'g'ridan-to'g'ri kiritamiz
          await updateSession(chatId, { step: 'authenticated' });
          return await sendFilesList(ctx, user);
        }

        // Oddiy parol solishtirish (bcrypt emas)
        if (text !== user.password) {
          return ctx.reply("❌ Parol noto'g'ri.\n\nQaytadan urinib ko'ring yoki boshqa papka tanlash uchun /start bosing.");
        }

        await updateSession(chatId, { step: 'authenticated' });
        
        // Fayllar ro'yxatini yuboramiz
        return await sendFilesList(ctx, user);
      }

      // AUTHENTICATED: Fayl tanlash yoki O'chirish rejimiga o'tish
      if (session.step === 'authenticated') {
        if (text === '0') {
          await updateSession(chatId, { step: 'deleting_file' });
          return ctx.reply("🗑 O'chirilishi kerak bo'lgan fayl tartib raqamini tanlang.\n\nChiqish uchun 00 ni jo'nating.");
        }
        
        const index = parseInt(text) - 1;
        const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
        
        if (!user || !user.drive_folder_id) {
          return ctx.reply("Papkangiz topilmadi. /start bosing.");
        }

        const drive = getDriveClient();
        const response = await drive.files.list({
          q: `'${user.drive_folder_id}' in parents and trashed = false`,
          fields: 'files(id, name, webContentLink)',
          orderBy: 'createdTime desc'
        });
        const files = response.data.files || [];

        if (isNaN(index) || index < 0 || index >= files.length) {
          return ctx.reply("Noto'g'ri raqam. Qayta urinib ko'ring.");
        }

        const file = files[index];
        const downloadLink = file.webContentLink || `https://drive.google.com/uc?export=download&id=${file.id}`;
        return ctx.reply(`📄 ${file.name}\n\n📥 Yuklab olish: ${downloadLink}`);
      }

      // DELETING_FILE: Faylni o'chirish
      if (session.step === 'deleting_file') {
        if (text === '00') {
          await updateSession(chatId, { step: 'authenticated' });
          
          const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
          if (user) {
            return await sendFilesList(ctx, user);
          }
          return ctx.reply("O'chirish rejimidan chiqdingiz.");
        }

        const index = parseInt(text) - 1;
        const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
        
        if (!user || !user.drive_folder_id) {
          return ctx.reply("Papkangiz topilmadi.");
        }

        const drive = getDriveClient();
        const response = await drive.files.list({
          q: `'${user.drive_folder_id}' in parents and trashed = false`,
          fields: 'files(id, name)',
          orderBy: 'createdTime desc'
        });
        const files = response.data.files || [];

        if (isNaN(index) || index < 0 || index >= files.length) {
          return ctx.reply("Noto'g'ri raqam.");
        }

        const file = files[index];
        try {
          await drive.files.delete({ fileId: file.id });
          return ctx.reply(`✅ "${file.name}" muvaffaqiyatli o'chirildi!\n\nYana o'chirish uchun raqam yuboring, chiqish uchun 00.`);
        } catch (e) {
          console.error('File delete error:', e);
          return ctx.reply("O'chirishda xatolik yuz berdi.");
        }
      }

      // Agar hech qaysi stepga to'g'ri kelmasa
      return ctx.reply("Noma'lum komanda. /start bosing.");
    } catch (error) {
      console.error('Bot text handler error:', error);
      return ctx.reply("Xatolik yuz berdi: " + error.message);
    }
  });

  // Fayl yuklash
  bot.on(['document', 'photo', 'video', 'audio'], async (ctx) => {
    const supabase = getSupabase();
    const chatId = ctx.chat.id;
    const session = await getSession(chatId);

    if (session.step !== 'authenticated' && session.step !== 'deleting_file') {
      return ctx.reply("Fayl yuklash uchun avval papkangizni tanlang va parolni kiriting.\n\n/start bosing.");
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
    if (!user) {
      return ctx.reply("Foydalanuvchi topilmadi. /start bosing.");
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
        return ctx.reply("Papka yaratishda xatolik yuz berdi.");
      }
    }

    try {
      const msg = await ctx.reply("⏳ Fayl Google Drive'ga yuklanmoqda, iltimos kuting...");

      const doc = ctx.message.document || ctx.message.video || ctx.message.audio || (ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1] : null);
      if (!doc) return ctx.reply("Fayl formati qo'llab-quvvatlanmaydi.");

      const fileId = doc.file_id;
      const fileName = doc.file_name || `file_${Date.now()}.${doc.mime_type ? doc.mime_type.split('/')[1] : 'bin'}`;
      const mimeType = doc.mime_type || 'application/octet-stream';

      const link = await ctx.telegram.getFileLink(fileId);

      const https = require('https');
      const drive = getDriveClient();

      https.get(link.href, async (stream) => {
        try {
          await drive.files.create({
            requestBody: {
              name: fileName,
              parents: [folderId]
            },
            media: {
              mimeType: mimeType,
              body: stream
            }
          });
          await ctx.reply(`✅ "${fileName}" fayli Google Drive papkangizga muvaffaqiyatli saqlandi!`);
        } catch (err) {
          console.error('Drive upload error:', err);
          await ctx.reply("Faylni Drive'ga yuklashda xatolik yuz berdi.");
        }
      });
    } catch (err) {
      console.error(err);
      await ctx.reply("Xatolik yuz berdi: " + err.message);
    }
  });
};

// Vercel Serverless Webhook export
// MUHIM: Telegram'ga DARHOL 200 OK javob beramiz, keyin so'rovni qayta ishlaymiz.
// Bu Vercel serverless muhitida botning qotib qolishini oldini oladi.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'Bot webhook is working' });
  }

  // Telegram'ga DARHOL javob beramiz (timeout oldini olish uchun)
  res.status(200).json({ ok: true });

  // Fon rejimida update'ni qayta ishlaymiz
  try {
    const currentBot = getBot();
    await currentBot.handleUpdate(req.body);
  } catch (error) {
    console.error('Bot handleUpdate error:', error);
  }
};
