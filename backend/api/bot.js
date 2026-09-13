const { Telegraf } = require('telegraf');
const { getSupabase, getDriveClient } = require('./utils');
const bcrypt = require('bcryptjs');

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

      let msg = "Salom! Guruh papkangizni tanlang (raqamni yuboring):\n\n";
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
    const supabase = getSupabase();
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();
    const session = await getSession(chatId);

    // IDLE: Talaba o'z raqamini jo'natadi
    if (session.step === 'idle') {
      const index = parseInt(text) - 1;
      const { data: users } = await supabase.from('users').select('id, name').order('id', { ascending: true });

      if (isNaN(index) || index < 0 || index >= users.length) {
        return ctx.reply("Iltimos, to'g'ri raqam kiriting (1 dan 20 gacha).");
      }

      const user = users[index];
      await updateSession(chatId, { step: 'waiting_password', selected_user_id: user.id });
      return ctx.reply(`Siz ${user.name} papkasini tanladingiz. Iltimos, parolingizni kiriting:`);
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

      if (!user.password_hash) {
        await updateSession(chatId, { step: 'idle', selected_user_id: null });
        return ctx.reply("Sizda hali parol o'rnatilmagan. Iltimos, avval Veb-sayt orqali kirib, parol o'rnating.");
      }

      const isValid = await bcrypt.compare(text, user.password_hash);
      if (!isValid) {
        return ctx.reply("Parol noto'g'ri. Iltimos, qaytadan urinib ko'ring yoki boshqa papka tanlash uchun /start bosing.");
      }

      if (!user.drive_folder_id) {
        return ctx.reply("Sizning Google Drive papkangiz topilmadi. Veb-saytga kirib yangilang.");
      }

      await updateSession(chatId, { step: 'authenticated' });

      // Fayllar ro'yxatini jo'natamiz
      const drive = getDriveClient();
      const response = await drive.files.list({
        q: `'${user.drive_folder_id}' in parents and trashed = false`,
        fields: 'files(id, name, webContentLink)',
        orderBy: 'createdTime desc'
      });

      const files = response.data.files || [];
      if (files.length === 0) {
        return ctx.reply("Papkangiz bo'sh. Fayl yuklash uchun shunchaki menga fayl jo'nating!\nBoshqa papkaga o'tish: /start");
      }

      let msg = "Fayllaringiz (Yuklab olish uchun fayl raqamini jo'nating):\n\nFaylni o'chirish uchun 0 ni jo'nating\n\n";
      files.forEach((f, i) => {
        msg += `${i + 1}. ${f.name}\n`;
      });

      return ctx.reply(msg);
    }

    // AUTHENTICATED: Fayl tanlash yoki O'chirish rejimiga o'tish
    if (session.step === 'authenticated') {
      if (text === '0') {
        await updateSession(chatId, { step: 'deleting_file' });
        return ctx.reply("O'chirilishi kerak bo'lgan fayl tartib raqamini tanlang, chiqish uchun 00 ni jo'nating.");
      }

      const index = parseInt(text) - 1;
      const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
      const drive = getDriveClient();
      const response = await drive.files.list({
        q: `'${user.drive_folder_id}' in parents and trashed = false`,
        fields: 'files(id, name, webContentLink)',
        orderBy: 'createdTime desc'
      });
      const files = response.data.files || [];

      if (isNaN(index) || index < 0 || index >= files.length) {
        return ctx.reply("Noto'g'ri raqam.");
      }

      const file = files[index];
      return ctx.reply(`${file.name}\nYuklab olish: ${file.webContentLink}`);
    }

    // DELETING_FILE: Faylni o'chirish
    if (session.step === 'deleting_file') {
      if (text === '00') {
        await updateSession(chatId, { step: 'authenticated' });
        return ctx.reply("O'chirish rejimidan chiqdingiz. Fayl raqamini yuborib uni yuklab olishingiz mumkin.");
      }

      const index = parseInt(text) - 1;
      const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
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
        return ctx.reply(`${file.name} muvaffaqiyatli o'chirildi!`);
      } catch (e) {
        return ctx.reply("O'chirishda xatolik yuz berdi.");
      }
    }
  });

  // Fayl yuklash
  bot.on(['document', 'photo', 'video', 'audio'], async (ctx) => {
    const supabase = getSupabase();
    const chatId = ctx.chat.id;
    const session = await getSession(chatId);

    if (session.step !== 'authenticated' && session.step !== 'deleting_file') {
      return ctx.reply("Fayl yuklash uchun avval papkangizni tanlang va parolni kiriting.");
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', session.selected_user_id).single();
    if (!user || !user.drive_folder_id) {
      return ctx.reply("Papkangiz topilmadi.");
    }

    try {
      const msg = await ctx.reply("Fayl Google Drive'ga yuklanmoqda, iltimos kuting...");

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
              parents: [user.drive_folder_id]
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
module.exports = async (req, res) => {
  try {
    const currentBot = getBot();
    if (req.method === 'POST') {
      await currentBot.handleUpdate(req.body, res);
    } else {
      res.status(200).json({ status: 'Bot webhook is working' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
