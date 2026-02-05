import { Telegraf, Markup } from 'telegraf';
import { google } from 'googleapis';

/* ================== ENV ================== */
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.IT_CHAT_ID; // ← ВАЖНО
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : null;

/* ================== BOT ================== */
const bot = new Telegraf(BOT_TOKEN);

/* ================== GOOGLE SHEETS ================== */
const auth = new google.auth.JWT(
  GOOGLE_CLIENT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY,
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });

async function addRow(data) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: SHEET_NAME,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data.sender,
        data.phone,
        data.type,
        data.service,
        data.comment || '',
        data.time,
        data.status || 'Новая'
      ]]
    }
  });
}

/* ================== SESSIONS ================== */
const sessions = {};

/* ================== KEYBOARDS ================== */
const mainKeyboard = Markup.keyboard([
  ['Принтер', 'Компьютер', 'Другое']
]).resize();

const printerKeyboard = Markup.keyboard([
  ['Замена картриджа', 'Не работает', 'Другое']
]).resize();

/* ================== BOT LOGIC ================== */
bot.start(async (ctx) => {
  const id = ctx.chat.id;
  sessions[id] = {};
  await ctx.reply(
    'Привет! Нажмите СТАРТ',
    Markup.keyboard([['СТАРТ']]).resize()
  );
});

bot.hears('СТАРТ', async (ctx) => {
  const id = ctx.chat.id;
  sessions[id] = { step: 'contact' };

  await ctx.reply(
    'Пожалуйста, поделитесь вашим номером:',
    Markup.keyboard([
      Markup.button.contactRequest('Отправить номер')
    ]).resize()
  );
});

bot.on('contact', async (ctx) => {
  const id = ctx.chat.id;
  const s = sessions[id];
  if (!s || s.step !== 'contact') return;

  s.phone = ctx.message.contact.phone_number;
  s.sender = ctx.message.contact.first_name;
  s.step = 'type';

  await ctx.reply('Выберите тип устройства:', mainKeyboard);
});

bot.hears(['Принтер', 'Компьютер', 'Другое'], async (ctx) => {
  const id = ctx.chat.id;
  const s = sessions[id];
  if (!s || !s.phone) return;

  s.type = ctx.message.text;

  if (s.type === 'Принтер') {
    s.step = 'printer';
    await ctx.reply('Выберите услугу:', printerKeyboard);
  } else {
    s.step = 'comment';
    await ctx.reply('Опишите проблему:');
  }
});

bot.hears(['Замена картриджа', 'Не работает', 'Другое'], async (ctx) => {
  const id = ctx.chat.id;
  const s = sessions[id];
  if (!s || s.type !== 'Принтер') return;

  s.service = ctx.message.text;

  if (s.service === 'Замена картриджа') {
    s.step = 'photo';
    await ctx.reply('Отправьте фото:');
  } else {
    s.step = 'comment';
    await ctx.reply('Опишите проблему:');
  }
});

bot.on('photo', async (ctx) => {
  const id = ctx.chat.id;
  const s = sessions[id];
  if (!s || s.step !== 'photo') return;

  s.photo = ctx.message.photo.at(-1).file_id;
  await sendResult(ctx, s);
});

bot.on('text', async (ctx) => {
  const id = ctx.chat.id;
  const s = sessions[id];
  if (!s || s.step !== 'comment') return;

  s.comment = ctx.message.text;
  await sendResult(ctx, s);
});

/* ================== SEND ================== */
async function sendResult(ctx, s) {
  const time = new Date().toLocaleString('ru-RU', { hour12: false });

  const text =
`Отправитель: ${s.sender}
Телефон: ${s.phone}
Тип: ${s.type}
Услуга: ${s.service || '—'}
Комментарий: ${s.comment || '—'}
Время: ${time}`;

  if (s.photo) {
    await ctx.telegram.sendPhoto(GROUP_ID, s.photo, { caption: text });
  } else {
    await ctx.telegram.sendMessage(GROUP_ID, text);
  }

  await addRow({
    sender: s.sender,
    phone: s.phone,
    type: s.type,
    service: s.service || '—',
    comment: s.comment,
    time,
    status: 'Новая'
  });

  await ctx.reply('Заявка отправлена ✅');
  delete sessions[ctx.chat.id];
}

/* ================== VERCEL HANDLER ================== */
export default async function handler(req, res) {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body);
    return res.status(200).send('OK');
  }

  res.status(200).json({ ok: true, message: 'Webhook alive' });
}
