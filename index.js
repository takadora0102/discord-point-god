// 🔧 全機能統合：登録・借金・返済・ショップ・ポイント・プロフィール・ランキング・ニックネーム変更 + Render対応Webサーバー
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const POINTS_FILE = './points.json';
function LoadPoints() {
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
  return JSON.parse(fs.readFileSync(POINTS_FILE));
}
function SavePoints(points) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(points, null, 2));
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
  'Duke': '公爵',
  'Marquis': '侯爵',
  'Count': '伯爵',
  'Viscount': '子爵',
  'Baron': '男爵',
  'Knight': '騎士',
  'Slave': '奴隷',
  'Serf': '農奴'
};

const ROLE_HIERARCHY = ['Duke','Marquis','Count','Viscount','Baron','Knight'];
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

function updateNickname(member) {
  const currentRoles = ROLE_HIERARCHY.concat(SLAVE_ROLE_NAME, SERF_ROLE_NAME);
  const role = currentRoles.find(r => member.roles.cache.some(role => role.name === r));
  if (role) {
    const title = ROLE_TITLES[role];
    const baseName = member.user.username;
    member.setNickname(`【${title}】${baseName}`).catch(() => {});
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
  const points = LoadPoints();
  const userId = interaction.user.id;
  const userData = points[userId] || { point: 0 };
  const guild = interaction.guild;
  const member = await guild.members.fetch(userId);

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'register') {
      if (points[userId]) {
        await interaction.reply('すでに登録済みです。');
      } else {
        points[userId] = { point: 1000 };
        SavePoints(points);
        const serfRole = guild.roles.cache.find(r => r.name === SERF_ROLE_NAME);
        if (serfRole) await member.roles.add(serfRole);
        updateNickname(member);
        await interaction.reply('✅ 登録完了！1000ポイントと農奴ロールが付与されました。');
      }
    }
    if (interaction.commandName === 'profile') {
      const roles = member.roles.cache.map(r => r.name).filter(r => r !== '@everyone').join(', ') || 'なし';
      const loanInfo = userData.loan ? `💳 借金：${userData.loan}pt\n⏳ 期限まで：${Math.ceil((userData.loanTimestamp + LOAN_DURATION_MS - Date.now()) / (1000 * 60 * 60 * 24))}日` : '💤 借金なし';
      await interaction.reply(`👤 **${interaction.user.username} のプロフィール**\n💰 所持ポイント：${userData.point}pt\n📜 ロール：${roles}\n${loanInfo}`);
    }
    if (interaction.commandName === 'borrow') {
      if (userData.loan) {
        await interaction.reply('❌ すでに借金があります。');
      } else {
        const amount = userData.point * BORROW_LIMIT_MULTIPLIER;
        userData.point += amount;
        userData.loan = amount;
        userData.loanTimestamp = Date.now();
        points[userId] = userData;
        SavePoints(points);
        await interaction.reply(`💸 ${amount}pt を借りました。返済期限は7日以内です。`);
      }
    }
    if (interaction.commandName === 'repay') {
      const amountArg = interaction.options?.getInteger('amount');
      if (!userData.loan) {
        await interaction.reply('💤 借金はありません。');
      } else if (!amountArg || amountArg <= 0) {
        await interaction.reply('⚠️ 正しい返済額を指定してください（例：/repay amount:500）');
      } else if (userData.point < amountArg) {
        await interaction.reply(`❌ ポイントが足りません。現在の所持：${userData.point}pt`);
      } else if (amountArg > userData.loan) {
        await interaction.reply(`⚠️ 借金残高は ${userData.loan}pt です。それ以上は返済できません。`);
      } else {
        userData.point -= amountArg;
        userData.loan -= amountArg;
        if (userData.loan === 0) userData.loanTimestamp = 0;
        points[userId] = userData;
        SavePoints(points);
        updateNickname(member);
        await interaction.reply(`✅ ${amountArg}pt を返済しました。残り借金：${userData.loan}pt`);
      }
    }
    if (interaction.commandName === 'ranking') {
      const top = Object.entries(points)
        .map(([id, data]) => ({ id, point: data.point || 0 }))
        .sort((a, b) => b.point - a.point)
        .slice(0, 10);
      const text = await Promise.all(top.map(async (u, i) => {
        try {
          const user = await client.users.fetch(u.id);
          return `🏅 ${i + 1}位: ${user.username} - ${u.point}pt`;
        } catch {
          return `🏅 ${i + 1}位: Unknown - ${u.point}pt`;
        }
      }));
      await interaction.reply(`📊 **ポイントランキング**\n${text.join('\n')}`);
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
    const roleName = interaction.customId.replace('buy_', '');
    const price = ROLE_PRICES[roleName] ?? 0;
    const role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
      await interaction.reply({ content: `❌ ${roleName} ロールが存在しません。`, ephemeral: true });
      return;
    }
    const index = ROLE_HIERARCHY.indexOf(roleName);
    if (index > 0) {
      const prevRoleName = ROLE_HIERARCHY[index - 1];
      const prevRole = guild.roles.cache.find(r => r.name === prevRoleName);
      if (!prevRole || !member.roles.cache.has(prevRole.id)) {
        await interaction.reply({ content: `⚠️ ${roleName} を購入するには ${prevRoleName} ロールが必要です。`, ephemeral: true });
        return;
      }
    }
    if (userData.point < price) {
      await interaction.reply({ content: `❌ ポイントが足りません。現在の所持：${userData.point}pt`, ephemeral: true });
      return;
    }
    await member.roles.add(role);
    userData.point -= price;
    points[userId] = userData;
    SavePoints(points);
    updateNickname(member);
    await interaction.reply({ content: `✅ ${roleName} を購入しました！残り ${userData.point}pt`, ephemeral: true });
  }
});

client.login(TOKEN);

// 🌐 Render対策：Expressでポートを開くダミーWebサーバー
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log(`🌐 Web server listening on port ${PORT}`));
