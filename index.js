const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Secret Files に合わせたパス（Render用）
const POINTS_FILE = '/etc/secrets/points.json';
const LOG_FILE = '/etc/secrets/activity_log.json';

function LoadPoints() {
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
  return JSON.parse(fs.readFileSync(POINTS_FILE));
}
function SavePoints(points) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(points, null, 2));
}
function loadActivityLog() {
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '{}');
  return JSON.parse(fs.readFileSync(LOG_FILE));
}
function saveActivityLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`✅ 起動完了：${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const points = LoadPoints();
    const userId = interaction.user.id;

    if (interaction.commandName === 'register') {
      if (points[userId]) {
        await interaction.reply('すでに登録されています！');
      } else {
        points[userId] = 1000;
        SavePoints(points);
        await interaction.reply('✅ 登録完了！1000ポイントを付与しました。');
      }
    }

    if (interaction.commandName === 'point') {
      const userPoints = points[userId] || 0;
      await interaction.reply(`💰 あなたのポイントは ${userPoints}pt です！`);
    }

    const shopTiers = ['slave', 'commoner', 'knight', 'noble', 'ruler'];
    if (shopTiers.includes(interaction.commandName)) {
      const labelMap = {
        slave: '奴隷層',
        commoner: '民衆層',
        knight: '準貴族層',
        noble: '貴族層',
        ruler: '支配層'
      };
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`buy_${interaction.commandName}`)
          .setLabel('商品Aを10ptで購入')
          .setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({
        content: `🛒 ${labelMap[interaction.commandName]}ショップ\n**商品A**：10pt`,
        components: [row]
      });
    }
  }

  if (interaction.isButton()) {
    const userId = interaction.user.id;
    const points = LoadPoints();
    const current = points[userId] || 0;

    if (current >= 10) {
      points[userId] -= 10;
      SavePoints(points);
      await interaction.reply({ content: `✅ 商品Aを購入しました！残り ${points[userId]}pt`, ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ ポイントが足りません！', ephemeral: true });
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const now = Date.now();

  const log = loadActivityLog();
  const points = LoadPoints();

  if (!log[userId]) log[userId] = [];

  const recentLogs = log[userId].filter(t => now - t < 3 * 60 * 1000);
  if (recentLogs.length < 20) {
    points[userId] = (points[userId] || 0) + 5;
    log[userId].push(now);
    SavePoints(points);
    saveActivityLog(log);
    console.log(`✅ ${message.author.username} に 5pt 付与（現在：${points[userId]}pt）`);
  } else {
    console.log(`⏸ ${message.author.username} はクールタイムまたは上限に達しています。`);
  }
});

(async () => {
  const commands = [
    new SlashCommandBuilder().setName('register').setDescription('ユーザー登録して1000ptをもらう'),
    new SlashCommandBuilder().setName('point').setDescription('自分のポイントを確認します'),
    new SlashCommandBuilder().setName('slave').setDescription('奴隷層のショップを表示'),
    new SlashCommandBuilder().setName('commoner').setDescription('民衆層のショップを表示'),
    new SlashCommandBuilder().setName('knight').setDescription('準貴族層のショップを表示'),
    new SlashCommandBuilder().setName('noble').setDescription('貴族層のショップを表示'),
    new SlashCommandBuilder().setName('ruler').setDescription('支配層のショップを表示')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('⏳ コマンド登録中...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ スラッシュコマンド登録完了');
  } catch (err) {
    console.error('コマンド登録エラー:', err);
  }
})();

client.login(TOKEN);

// Render / Replit対応のExpressサーバー（UptimeRobot用）
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is alive.'));
app.listen(3000, () => console.log('🌐 Webサーバー稼働中 (ポート3000)'));
