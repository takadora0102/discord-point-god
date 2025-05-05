// 🔧 全機能統合（ショップ生成・降格・ポイント加算・階級表示・スラッシュコマンド対応）
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const POINTS_FILE = './points.json';
const ACTIVITY_LOG = './activity_log.json';
function LoadPoints() {
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
  return JSON.parse(fs.readFileSync(POINTS_FILE));
}
function SavePoints(points) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(points, null, 2));
}
function LoadLog() {
  if (!fs.existsSync(ACTIVITY_LOG)) fs.writeFileSync(ACTIVITY_LOG, '{}');
  return JSON.parse(fs.readFileSync(ACTIVITY_LOG));
}
function SaveLog(log) {
  fs.writeFileSync(ACTIVITY_LOG, JSON.stringify(log, null, 2));
}

const BORROW_LIMIT_MULTIPLIER = 3;
const LOAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const ROLE_PRICES = {
  'Knight': 10000,
  'Baron': 0,
  'Viscount': 0,
  'Count': 0,
  'Marquis': 0,
  'Duke': 0
};
const ROLE_TITLES = {
  'Duke': '公爵', 'Marquis': '侯爵', 'Count': '伯爵', 'Viscount': '子爵', 'Baron': '男爵', 'Knight': '騎士', 'Slave': '奴隷', 'Serf': '農奴'
};
const ROLE_HIERARCHY = ['Duke','Marquis','Count','Viscount','Baron','Knight','Serf','Slave'];
const CATEGORY_ROLE_MAP = {
  '民衆ショップ': ['Knight'],
  '準貴族ショップ': ['Baron'],
  '貴族ショップ': ['Viscount', 'Count', 'Marquis', 'Duke'],
  '支配層ショップ': ['商品A']
};
const SLAVE_ROLE_NAME = 'Slave';
const SERF_ROLE_NAME = 'Serf';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`✅ 起動完了：${client.user.tag}`);
});

function updateNickname(member) {
  const role = ROLE_HIERARCHY.find(r => member.roles.cache.some(role => role.name === r));
  if (role) {
    const title = ROLE_TITLES[role];
    const baseName = member.user.username;
    member.setNickname(`【${title}】${baseName}`).catch(() => {});
  }
}

cron.schedule('0 * * * *', async () => {
  const points = LoadPoints();
  const guild = await client.guilds.fetch(GUILD_ID);
  for (const [userId, data] of Object.entries(points)) {
    if (data.loan && Date.now() > data.loanTimestamp + LOAN_DURATION_MS) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      const slaveRole = guild.roles.cache.find(r => r.name === SLAVE_ROLE_NAME);
      if (slaveRole) {
        member.roles.set([slaveRole]);
        updateNickname(member);
        data.point = -data.loan;
        delete data.loan;
        delete data.loanTimestamp;
        console.log(`⛓️ ${member.user.username} を奴隷に降格`);
      }
    }
  }
  SavePoints(points);
});

client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  const points = LoadPoints();
  const log = LoadLog();
  const id = msg.author.id;
  const now = Date.now();
  if (!log[id]) log[id] = [];
  log[id] = log[id].filter(t => now - t < 86400000);
  if (log[id].length < 20) {
    if (!points[id]) points[id] = { point: 0 };
    points[id].point += 5;
    log[id].push(now);
    SavePoints(points);
    SaveLog(log);
    console.log(`💬 ${msg.author.username} に5pt付与`);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
  const points = LoadPoints();
  const userId = interaction.user.id;
  const userData = points[userId] || { point: 0 };
  const guild = interaction.guild;
  const member = await guild.members.fetch(userId);

  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;
    if (cmd === 'register') {
      points[userId] = { point: 1000 };
      SavePoints(points);
      const serfRole = guild.roles.cache.find(r => r.name === SERF_ROLE_NAME);
      if (serfRole) await member.roles.add(serfRole);
      updateNickname(member);
      await interaction.reply('✅ 登録完了！1000ptと農奴ロールが付与されました。');
    } else if (cmd === 'profile') {
      const roles = member.roles.cache.map(r => r.name).filter(r => r !== '@everyone').join(', ') || 'なし';
      const loanInfo = userData.loan ? `💳 借金：${userData.loan}pt\n⏳ 返済期限：${Math.ceil((userData.loanTimestamp + LOAN_DURATION_MS - Date.now()) / 86400000)}日` : '💤 借金なし';
      await interaction.reply(`👤 **${interaction.user.username}**\n💰 所持ポイント：${userData.point}pt\n📜 ロール：${roles}\n${loanInfo}`);
    } else if (cmd === 'borrow') {
      if (userData.loan) {
        await interaction.reply('❌ すでに借金があります');
      } else {
        const amount = userData.point * BORROW_LIMIT_MULTIPLIER;
        userData.point += amount;
        userData.loan = amount;
        userData.loanTimestamp = Date.now();
        points[userId] = userData;
        SavePoints(points);
        await interaction.reply(`💸 ${amount}pt を借りました。返済期限は7日以内です。`);
      }
    } else if (cmd === 'repay') {
      const amount = interaction.options.getInteger('amount');
      if (!userData.loan) {
        await interaction.reply('💤 借金はありません');
      } else if (amount <= 0 || amount > userData.point) {
        await interaction.reply('⚠️ 無効な返済額です');
      } else {
        userData.point -= amount;
        userData.loan -= amount;
        if (userData.loan <= 0) delete userData.loanTimestamp;
        if (userData.loan <= 0) delete userData.loan;
        SavePoints(points);
        updateNickname(member);
        await interaction.reply(`✅ ${amount}pt 返済しました。残債：${userData.loan || 0}pt`);
      }
    } else if (cmd === 'ranking') {
      const top = Object.entries(points).map(([id, d]) => ({ id, pt: d.point || 0 }))
        .sort((a, b) => b.pt - a.pt).slice(0, 10);
      const text = await Promise.all(top.map(async (u, i) => {
        try {
          const user = await client.users.fetch(u.id);
          return `🏅 ${i + 1}. ${user.username} - ${u.pt}pt`;
        } catch {
          return `🏅 ${i + 1}. Unknown - ${u.pt}pt`;
        }
      }));
      await interaction.reply(`📊 ポイントランキング：\n${text.join('\n')}`);
    } else if (cmd === 'createshop') {
      const category = interaction.options.getString('category');
      const roles = CATEGORY_ROLE_MAP[category];
      if (!roles) {
        await interaction.reply({ content: '❌ 無効なカテゴリーです。', ephemeral: true });
        return;
      }
      const components = roles.map(roleName => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`buy_${roleName}`).setLabel(`${roleName} を購入`).setStyle(ButtonStyle.Primary)
      ));
      await interaction.reply({ content: `🛒 ${category}ショップ：\n${roles.map(r => `- ${r}: ${ROLE_PRICES[r] || 0}pt`).join('\n')}`, components });
    }
  } else if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
    const roleName = interaction.customId.replace('buy_', '');
    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
    const price = ROLE_PRICES[roleName] || 0;
    if (!role) return interaction.reply({ content: '❌ ロールが見つかりません。', ephemeral: true });
    const index = ROLE_HIERARCHY.indexOf(roleName);
    if (index > 0) {
      const prevRole = interaction.guild.roles.cache.find(r => r.name === ROLE_HIERARCHY[index - 1]);
      if (!member.roles.cache.has(prevRole?.id)) {
        return interaction.reply({ content: `⚠️ ${roleName}を購入するには ${prevRole.name} が必要です`, ephemeral: true });
      }
    }
    if (userData.point < price) {
      return interaction.reply({ content: '❌ ポイントが足りません。', ephemeral: true });
    }
    await member.roles.add(role);
    userData.point -= price;
    SavePoints(points);
    updateNickname(member);
    await interaction.reply({ content: `✅ ${roleName} を購入しました！残り ${userData.point}pt`, ephemeral: true });
  }
});

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: [
        new SlashCommandBuilder().setName('register').setDescription('ユーザー登録'),
        new SlashCommandBuilder().setName('profile').setDescription('ポイント・ロール・借金確認'),
        new SlashCommandBuilder().setName('borrow').setDescription('借金（上限3倍）'),
        new SlashCommandBuilder().setName('repay').setDescription('借金を返済する').addIntegerOption(opt => opt.setName('amount').setDescription('返済額').setRequired(true)),
        new SlashCommandBuilder().setName('ranking').setDescription('ポイントランキング表示'),
        new SlashCommandBuilder().setName('createshop').setDescription('ショップメッセージを生成').addStringOption(opt => opt.setName('category').setDescription('ショップカテゴリー').setRequired(true))
      ].map(c => c.toJSON())
    });
    console.log('✅ スラッシュコマンド登録完了');
  } catch (err) {
    console.error('❌ スラッシュコマンド登録失敗:', err);
  }
})();

const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is running.'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Webサーバー起動'));
