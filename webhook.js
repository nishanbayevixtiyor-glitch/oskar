export default function handler(req, res) {
  res.status(200).json({ ok: true, message: 'webhook alive' });
}

import { google } from 'googleapis';
import fetch from 'node-fetch';
import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

const bot = new Telegraf(BOT_TOKEN);

// Google Sheets auth
const auth = new google.auth.JWT(
  GOOGLE_CLIENT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY,
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });

// Функция записи заявки в Google Sheets
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

// Хранилище состояния пользователей (для выбора меню)
const sessions = {};

// Вспомогательные клавиатуры
const mainKeyboard = Markup.keyboard([['Принтер', 'Компьютер', 'Другое']]).resize();
const printerKeyboard = Markup.keyboard([['Замена картриджа', 'Не работает', 'Другое']]).resize();

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  if (!sessions[chatId]) sessions[chatId] = {};
  
  await ctx.reply('Привет! Нажмите СТАРТ', Markup.keyboard([['СТАРТ']]).resize());
});

bot.hears('СТАРТ', async (ctx) => {
  const chatId = ctx.chat.id;
  sessions[chatId] = { step: 'ask_contact' };
  await ctx.reply('Пожалуйста, поделитесь вашим номером:', Markup.keyboard([
    Markup.button.contactRequest('Отправить номер')
  ]).resize());
});

bot.on('contact', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!sessions[chatId] || sessions[chatId].step !== 'ask_contact') return;
  
  sessions[chatId].phone = ctx.message.contact.phone_number;
  sessions[chatId].sender = ctx.message.contact.first_name;
  sessions[chatId].step = 'choose_type';
  
  await ctx.reply('Выберите тип устройства:', mainKeyboard);
});

bot.hears(['Принтер', 'Компьютер', 'Другое'], async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions[chatId];
  if (!session || !session.phone) return;

  session.type = ctx.message.text;
  
  if (session.type === 'Принтер') {
    session.step = 'printer_service';
    await ctx.reply('Выберите услугу:', printerKeyboard);
  } else {
    session.step = 'comment';
    await ctx.reply('Опишите проблему:');
  }
});

bot.hears(['Замена картриджа', 'Не работает', 'Другое'], async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions[chatId];
  if (!session || session.type !== 'Принтер') return;

  session.service = ctx.message.text;

  if (session.service === 'Замена картриджа') {
    session.step = 'photo';
    await ctx.reply('Пожалуйста, отправьте фото:');
  } else if (session.service === 'Другое' || session.service === 'Не работает') {
    session.step = 'comment';
    await ctx.reply('Опишите проблему:');
  } else {
    // если другая услуга — сразу отправляем
    await sendToGroup(ctx, session);
  }
});

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions[chatId];
  if (!session || session.step !== 'photo') return;

  // Берём самую крупную версию фото
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  session.photoFileId = photo.file_id;

  await sendToGroup(ctx, session);
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions[chatId];
  if (!session) return;

  if (session.step === 'comment') {
    session.comment = ctx.message.text;
    await sendToGroup(ctx, session);
  }
});

// Функция отправки заявки в группу и Google Sheets
async function sendToGroup(ctx, session) {
  const time = new Date().toLocaleString('ru-RU', { hour12: false });
  const message = `Отправитель: ${session.sender}\nТел.номер: ${session.phone}\nТип: ${session.type}\nУслуга: ${session.service || '—'}\nКомментарий: ${session.comment || '—'}\nВремя отправки: ${time}`;

  if (session.photoFileId) {
    await ctx.telegram.sendPhoto(GROUP_ID, session.photoFileId, { caption: message });
  } else {
    await ctx.telegram.sendMessage(GROUP_ID, message);
  }

  // Сохраняем в Google Sheets
  await addRow({
    sender: session.sender,
    phone: session.phone,
    type: session.type,
    service: session.service || session.comment || '—',
    comment: session.comment,
    time,
    status: 'Новая'
  });

  await ctx.reply('Заявка отправлена! Спасибо!');
  delete sessions[ctx.chat.id];
}

// Vercel handler
export default async function handler(req, res) {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } else {
    res.status(200).send('Telegram bot is running');
  }
}
