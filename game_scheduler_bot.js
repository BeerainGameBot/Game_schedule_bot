// ============================================================
// 🎮 Game Session Scheduler Bot
// ============================================================
// Setup:
//   1. npm install discord.js
//   2. Create a bot at https://discord.com/developers/applications
//   3. Enable "Message Content Intent" and "Server Members Intent"
//   4. Set your BOT_TOKEN below
//   5. node game_scheduler_bot.js
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN; // Set this in Railway environment variables

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── In-memory session store ──────────────────────────────────
// sessions[id] = { id, game, date, time, timezone, host, players, maxPlayers, note, messageId, channelId, notified }
const sessions = new Map();
let sessionCounter = 1;

// ─── Timezone offsets ────────────────────────────────────────
const TIMEZONE_OFFSETS = {
  'EST': -5, 'EDT': -4,
  'CST': -6, 'CDT': -5,
  'MST': -7, 'MDT': -6,
  'PST': -8, 'PDT': -7,
  'UTC': 0,  'GMT': 0,
  'BST': 1,  'CET': 1,
  'EET': 2,  'IST': 5.5,
  'JST': 9,  'AEST': 10,
  'AEDT': 11, 'NZST': 12,
};

// Auto-detect US DST (works on UTC servers)
function isUSDST(date) {
  const year = date.getUTCFullYear();
  // DST starts second Sunday of March at 2am local
  const marchStart = new Date(Date.UTC(year, 2, 1));
  const marchDay = marchStart.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, (14 - marchDay) % 7 + 8, 9)); // 2am PT = 9am UTC (PST)
  // DST ends first Sunday of November at 2am local
  const novStart = new Date(Date.UTC(year, 10, 1));
  const novDay = novStart.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, (7 - novDay) % 7 + 1, 9)); // 2am PT = 9am UTC (PDT)
  return date >= dstStart && date < dstEnd;
}

function resolveTimezone(tz) {
  const now = new Date();
  const dst = isUSDST(now);

  // Auto-convert specific zones to their general form first
  const normalizeMap = {
    'PST': 'PT', 'PDT': 'PT',
    'EST': 'ET', 'EDT': 'ET',
    'CST': 'CT', 'CDT': 'CT',
    'MST': 'MT', 'MDT': 'MT',
  };

  const normalized = normalizeMap[tz.toUpperCase()] || tz.toUpperCase();

  const dstMap = {
    'PT':  dst ? 'PDT' : 'PST',
    'ET':  dst ? 'EDT' : 'EST',
    'CT':  dst ? 'CDT' : 'CST',
    'MT':  dst ? 'MDT' : 'MST',
  };
  return dstMap[normalized] || normalized;
}

// ─── Notification checker (runs every minute) ─────────────────
function parseSessionTime(session) {
  try {
    const tz = resolveTimezone(session.timezone.trim());
    const offset = TIMEZONE_OFFSETS[tz] !== undefined ? TIMEZONE_OFFSETS[tz] : 0;

    // Parse date and time parts manually to avoid JS local timezone interference
    const raw = `${session.date} ${session.time}`;
    const parsed = new Date(raw + ' UTC'); // force parse as UTC first
    if (isNaN(parsed.getTime())) return null;

    // Then shift back by the timezone offset to get true UTC time
    // e.g. 12:15 PM PST: parse as 12:15 UTC, then subtract -8hrs = add 8hrs = 8:15 PM UTC
    parsed.setTime(parsed.getTime() - offset * 60 * 60 * 1000);

    return parsed;
  } catch {}
  return null;
}

async function checkNotifications() {
  const now = new Date();
  for (const session of sessions.values()) {
    if (session.notified) continue;

    const sessionTime = parseSessionTime(session);
    if (!sessionTime) {
      console.log(`[Session #${session.id}] Could not parse time: ${session.date} ${session.time} ${session.timezone}`);
      continue;
    }

    const diffMs = sessionTime - now;
    const diffMins = diffMs / 60000;
    console.log(`[Session #${session.id}] Now: ${now.toISOString()} | Session UTC: ${sessionTime.toISOString()} | Diff: ${diffMins.toFixed(2)} mins`);

    // Send a 15-minute warning
    if (diffMins <= 15 && diffMins > 0 && !session.warned) {
      session.warned = true;
      try {
        const channel = await client.channels.fetch(session.channelId);
        const game = GAMES[session.game] || GAMES.other;
        const pings = session.players.map(p => `<@${p}>`).join(' ');
        await channel.send({
          content: `⏰ **15 minute warning!** ${pings}\n${game.emoji} **${game.label}** starts at **${session.time} ${session.timezone}** — get ready!`,
        });
      } catch (e) {
        console.error('Warning notification failed:', e.message);
      }
    }

    // Send the "it's time!" ping
    if (diffMins <= 0 && diffMins > -5 && !session.notified) {
      session.notified = true;
      try {
        const channel = await client.channels.fetch(session.channelId);
        const game = GAMES[session.game] || GAMES.other;
        const pings = session.players.map(p => `<@${p}>`).join(' ');
        await channel.send({
          content: `🚨 **IT'S TIME TO PLAY!** ${pings}\n${game.emoji} **${game.label}** session is starting NOW! Get in! 🎮`,
        });
      } catch (e) {
        console.error('Start notification failed:', e.message);
      }
    }
  }
}

// Start the notification checker — runs every 60 seconds
setInterval(checkNotifications, 60000);

// ─── Game definitions ─────────────────────────────────────────
const GAMES = {
  valorant:      { label: 'Valorant',       emoji: '🔫', color: 0xFF4655, maxPlayers: 5,  thumbnail: 'https://cdn.vectorstock.com/i/1000v/37/87/valorant-logo-icon-gaming-streamer-vector-33193787.jpg' },
  marvel_rivals: { label: 'Marvel Rivals',  emoji: '🦸', color: 0xB22222, maxPlayers: 6,  thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS17Vz2u_vSnAwMDSzLK2z3trBAHVyzVolpFA&s' },
  cod:           { label: 'Call of Duty',   emoji: '🪖', color: 0x4B4B4B, maxPlayers: 6,  thumbnail: 'https://images.seeklogo.com/logo-png/49/2/call-of-duty-2023-logo-png_seeklogo-493029.png' },
  marathon:      { label: 'Marathon',       emoji: '🏃', color: 0x00BFFF, maxPlayers: 6,  thumbnail: 'https://i.pinimg.com/736x/c8/ce/13/c8ce13ac1e69d9cfd8daa31422ad2dc8.jpg' },
  apex:          { label: 'Apex Legends',   emoji: '🔴', color: 0xCD7F32, maxPlayers: 3,  thumbnail: 'https://thumbs.dreamstime.com/b/apex-legends-logo-illustration-video-game-along-its-name-144082430.jpg' },
  fortnite:      { label: 'Fortnite',       emoji: '🌀', color: 0x00C8FF, maxPlayers: 4,  thumbnail: 'https://static.wikia.nocookie.net/logopedia/images/d/db/Fortnite_S1.svg/revision/latest/scale-to-width-down/250?cb=20210330161743' },
  overwatch:     { label: 'Overwatch 2',    emoji: '🛡️', color: 0xF99E1A, maxPlayers: 5,  thumbnail: 'https://i.redd.it/overwatch-logo-is-crooked-v0-rvhzuzye7gdf1.png?width=596&format=png&auto=webp&s=a9a6e3bb026b4276599ecb82874714fc7ae77281' },
  rocket_league: { label: 'Rocket League',  emoji: '🚀', color: 0x0073E6, maxPlayers: 3,  thumbnail: 'https://preview.redd.it/when-did-they-change-the-rocket-league-logo-v0-z2e6qkaekcb11.png?width=300&format=png&auto=webp&s=60a025969f46e7935898e6fb7e0e284048f0b6fc' },
  minecraft:     { label: 'Minecraft',      emoji: '⛏️', color: 0x56A850, maxPlayers: 10, thumbnail: 'https://i.imgur.com/nKsYRdJ.png' },
  horror:        { label: 'Horror Game',     emoji: '👻', color: 0x4B0082, maxPlayers: 8,  thumbnail: '' },
  watch_party:   { label: 'Watch Party',     emoji: '🍿', color: 0xE50914, maxPlayers: 10, thumbnail: '' },
  other:         { label: 'Other',          emoji: '🎮', color: 0x7289DA, maxPlayers: 8,  thumbnail: '' },
};

// ─── Flexible time parser ─────────────────────────────────────
function parseFlexibleTime(input) {
  const lower = input.toLowerCase().trim().replace(/\s+/g, '');

  // Match formats like 8pm, 8:30pm, 8:30p, 830pm, 11am
  const match = lower.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?$/);
  if (!match) return input;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? match[2] : '00';
  let period = null;

  if (match[3]) {
    if (match[3] === 'a' || match[3] === 'am') period = 'AM';
    if (match[3] === 'p' || match[3] === 'pm') period = 'PM';
  }

  // If no period given, assume PM for 1-11, AM for 12
  if (!period) {
    period = (hours >= 1 && hours <= 11) ? 'PM' : 'AM';
  }

  // Normalize to 12-hour
  if (hours === 0) hours = 12;
  if (hours > 12) hours = hours - 12;

  return `${hours}:${minutes} ${period}`;
}

// ─── Flexible date parser ─────────────────────────────────────
function parseFlexibleDate(input, timezone) {
  // Get current time adjusted for the user's timezone
  const tz = resolveTimezone(timezone || 'UTC');
  const offset = TIMEZONE_OFFSETS[tz] !== undefined ? TIMEZONE_OFFSETS[tz] : 0;
  const now = new Date(Date.now() + offset * 60 * 60 * 1000);
  const lower = input.toLowerCase().trim();

  if (lower === 'today') {
    return now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  if (lower === 'tomorrow') {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() + 1);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  // Day names: monday, tuesday, etc.
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayIndex = days.indexOf(lower);
  if (dayIndex !== -1) {
    const d = new Date(now);
    const diff = (dayIndex - d.getUTCDay() + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  // Handle MM/DD/YY or MM/DD/YYYY format
  const shortDate = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (shortDate) {
    let year = parseInt(shortDate[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, parseInt(shortDate[1], 10) - 1, parseInt(shortDate[2], 10)));
    if (!isNaN(d)) return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  // Try native Date parse as fallback
  const parsed = new Date(input);
  if (!isNaN(parsed)) {
    return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  // Return as-is if nothing matched
  return input;
}

// ─── Apply edit to a session ──────────────────────────────────
function applyEdit(session, field, value) {
  if (field === 'date') {
    session.date = parseFlexibleDate(value, session.timezone);
    session.warned = false;
    session.notified = false;
  } else if (field === 'time') {
    session.time = parseFlexibleTime(value);
    session.warned = false;
    session.notified = false;
  } else if (field === 'timezone') {
    session.timezone = value;
    session.warned = false;
    session.notified = false;
  } else if (field === 'note') {
    session.note = value;
  } else if (field === 'game') {
    const gameKey = Object.keys(GAMES).find(k => GAMES[k].label.toLowerCase() === value.toLowerCase() || k === value.toLowerCase());
    if (gameKey) session.game = gameKey;
  }
}

// ─── Helpers ──────────────────────────────────────────────────
function buildSessionEmbed(session) {
  const game = GAMES[session.game] || GAMES.other;
  const playerList = session.players.length > 0
    ? session.players.map((p, i) => `${i + 1}. <@${p}>`).join('\n')
    : '*No one yet — be the first!*';

  const spotsLeft = session.maxPlayers - session.players.length;

  const embed = new EmbedBuilder()
    .setTitle(`${game.label} Session`)
    .setColor(game.color);

  if (game.thumbnail) embed.setThumbnail(game.thumbnail);

  embed.addFields(
      { name: '📅 Date',    value: session.date,     inline: true },
      { name: '⏰ Time',    value: session.time,     inline: true },
      { name: '🌍 Zone',   value: session.timezone, inline: true },
      { name: `👥 Players (${session.players.length}/${session.maxPlayers})`, value: playerList },
      ...(session.note ? [{ name: '📝 Note', value: session.note }] : []),
    )
    .setFooter({ text: `Session #${session.id}  •  Hosted by ${session.hostTag}  •  ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left` })
    .setTimestamp();

  return embed;
}

function buildSessionButtons(session) {
  const joined = (userId) => session.players.includes(userId);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_${session.id}`)
      .setLabel('Join')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(session.players.length >= session.maxPlayers),
    new ButtonBuilder()
      .setCustomId(`leave_${session.id}`)
      .setLabel('Leave')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cancel_${session.id}`)
      .setLabel('Cancel Session')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`invite_${session.id}`)
      .setLabel('Invite')
      .setEmoji('📣')
      .setStyle(ButtonStyle.Primary),
  );
}

async function refreshSessionMessage(session) {
  try {
    const channel = await client.channels.fetch(session.channelId);
    const message = await channel.messages.fetch(session.messageId);
    await message.edit({
      embeds: [buildSessionEmbed(session)],
      components: [buildSessionButtons(session)],
    });
  } catch (e) {
    console.error('Could not refresh session message:', e.message);
  }
}

// ─── Bot Ready ────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log('Commands: !schedule, !sessions, !cancelsession <id>, !help');
});

// ─── Message Commands ─────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();

  // ── !help ──
  if (content === '!help') {
    const embed = new EmbedBuilder()
      .setTitle('🎮 Game Scheduler Bot — Commands')
      .setColor(0x7289DA)
      .addFields(
        { name: '!schedule',              value: 'Create a new game session (interactive)' },
        { name: '!sessions',              value: 'List all active sessions' },
        { name: '!invite <id> @friends',  value: 'Invite friends to a session by tagging them' },
        { name: '!edit <id> <field> <value>', value: 'Edit a session — fields: date, time, timezone, note, game' },
        { name: '!cancelsession <id>',    value: 'Cancel a session you hosted' },
      )
      .setFooter({ text: 'Use the buttons on each session to join or leave.' });
    return message.channel.send({ embeds: [embed] });
  }

  // ── !sessions ──
  if (content === '!sessions') {
    if (sessions.size === 0) {
      return message.reply('No active sessions right now. Use `!schedule` to create one!');
    }
    const lines = [...sessions.values()].map(s => {
      const g = GAMES[s.game] || GAMES.other;
      return `**#${s.id}** ${g.emoji} ${g.label} — ${s.date} ${s.time} ${s.timezone} — ${s.players.length}/${s.maxPlayers} players`;
    });
    const embed = new EmbedBuilder()
      .setTitle('📋 Active Game Sessions')
      .setColor(0x7289DA)
      .setDescription(lines.join('\n'));
    return message.channel.send({ embeds: [embed] });
  }

  // ── !invite @user1 @user2 ──
  if (content.startsWith('!invite')) {
    const mentionedIds = [...message.mentions.users.keys()].filter(uid => uid !== message.author.id);
    if (mentionedIds.length === 0) return message.reply('Please mention at least one friend, e.g. !invite @friend');

    const activeSessions = [...sessions.values()];
    if (activeSessions.length === 0) return message.reply('No active sessions! Use !schedule to create one first.');

    // If only one session, auto-pick it
    if (activeSessions.length === 1) {
      const session = activeSessions[0];
      for (const uid of mentionedIds) {
        if (!session.players.includes(uid) && session.players.length < session.maxPlayers) {
          session.players.push(uid);
        }
      }
      const game = GAMES[session.game] || GAMES.other;
      const pings = mentionedIds.map(id => `<@${id}>`).join(' ');
      await message.channel.send({
        content: `📣 ${pings} — **${message.author.username}** has added you to a **${game.emoji} ${game.label}** session!
📅 **${session.date}** at **${session.time} ${session.timezone}** — you're in! ✅`,
        embeds: [buildSessionEmbed(session)],
        components: [buildSessionButtons(session)],
      });
      await refreshSessionMessage(session);
      return;
    }

    // Multiple sessions — show a dropdown to pick one
    const sessionOptions = activeSessions.map(s => {
      const g = GAMES[s.game] || GAMES.other;
      return {
        label: `#${s.id} ${g.label} — ${s.date} ${s.time}`,
        value: `${s.id}:${mentionedIds.join(',')}`,
      };
    });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('invite_session_select')
        .setPlaceholder('Pick a session to invite them to...')
        .addOptions(sessionOptions)
    );

    return message.reply({
      content: `Which session do you want to add ${mentionedIds.map(id => `<@${id}>`).join(' ')} to?`,
      components: [row],
    });
  }

  // ── !edit <field> <value> ──
  if (content.startsWith('!edit')) {
    const parts = content.split(' ');
    const field = parts[1]?.toLowerCase();
    const value = parts.slice(2).join(' ').trim();

    if (!field || !value) return message.reply('Usage: !edit <field> <value>\nFields: date, time, timezone, note, game');

    const activeSessions = [...sessions.values()].filter(s => s.hostId === message.author.id);
    if (activeSessions.length === 0) return message.reply('You have no active sessions to edit!');

    // If only one session, auto-pick it
    if (activeSessions.length === 1) {
      const session = activeSessions[0];
      applyEdit(session, field, value);
      await refreshSessionMessage(session);
      return message.reply(`✅ Session #${session.id} updated!`);
    }

    // Multiple sessions — show dropdown
    const sessionOptions = activeSessions.map(s => {
      const g = GAMES[s.game] || GAMES.other;
      return {
        label: `#${s.id} ${g.label} — ${s.date} ${s.time}`,
        value: `${s.id}:${field}:${value}`,
      };
    });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('edit_session_select')
        .setPlaceholder('Pick a session to edit...')
        .addOptions(sessionOptions)
    );

    return message.reply({
      content: `Which session do you want to edit?`,
      components: [row],
    });
  }

  // ── !cancelsession <id> ──
  if (content.startsWith('!cancelsession')) {
    const parts = content.split(' ');
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) return message.reply('Usage: `!cancelsession <session id>`');
    const session = sessions.get(id);
    if (!session) return message.reply(`Session #${id} not found.`);
    if (session.hostId !== message.author.id) return message.reply('Only the host can cancel this session.');

    sessions.delete(id);
    try {
      const channel = await client.channels.fetch(session.channelId);
      const msg = await channel.messages.fetch(session.messageId);
      await msg.edit({
        embeds: [new EmbedBuilder()
          .setTitle(`❌ Session #${id} Cancelled`)
          .setColor(0xFF0000)
          .setDescription(`The ${GAMES[session.game]?.label || 'game'} session scheduled for **${session.date} ${session.time}** has been cancelled by the host.`)],
        components: [],
      });
    } catch {}
    return message.reply(`Session #${id} cancelled.`);
  }

  // ── !schedule ──
  if (content === '!schedule') {
    // Step 1: show game selector
    const gameOptions = Object.entries(GAMES).map(([value, g]) => ({
      label: g.label,
      value,
      emoji: g.emoji,
    }));
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_game_new')
        .setPlaceholder('Choose a game...')
        .addOptions(gameOptions)
    );
    await message.channel.send({
      content: `<@${message.author.id}> **Step 1/4 — Pick a game:**`,
      components: [row],
    });
  }
});

// ─── Interactions ──────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── Edit session selector ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'edit_session_select') {
    const [sessionId, field, ...valueParts] = interaction.values[0].split(':');
    const value = valueParts.join(':');
    const session = sessions.get(parseInt(sessionId, 10));
    if (!session) return interaction.reply({ content: 'Session not found.', ephemeral: true });
    if (session.hostId !== interaction.user.id) return interaction.reply({ content: 'Only the host can edit this session.', ephemeral: true });

    applyEdit(session, field, value);
    await refreshSessionMessage(session);
    return interaction.update({ content: `✅ Session #${session.id} updated!`, components: [] });
  }

  // ── Invite session selector ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'invite_session_select') {
    const [sessionId, userIds] = interaction.values[0].split(':');
    const session = sessions.get(parseInt(sessionId, 10));
    if (!session) return interaction.reply({ content: 'Session not found.', ephemeral: true });

    const mentionedIds = userIds.split(',');
    for (const uid of mentionedIds) {
      if (!session.players.includes(uid) && session.players.length < session.maxPlayers) {
        session.players.push(uid);
      }
    }

    const game = GAMES[session.game] || GAMES.other;
    const pings = mentionedIds.map(id => `<@${id}>`).join(' ');
    await interaction.update({ content: `✅ Done! Invites sent.`, components: [] });
    await interaction.channel.send({
      content: `📣 ${pings} — **${interaction.user.username}** has added you to a **${game.emoji} ${game.label}** session!
📅 **${session.date}** at **${session.time} ${session.timezone}** — you're in! ✅`,
      embeds: [buildSessionEmbed(session)],
      components: [buildSessionButtons(session)],
    });
    await refreshSessionMessage(session);
    return;
  }

  // ── Game selector ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_game_new') {
    const selectedGame = interaction.values[0];
    const game = GAMES[selectedGame];

    // Show modal for date/time/note
    const modal = new ModalBuilder()
      .setCustomId(`schedule_modal_${selectedGame}`)
      .setTitle(`Schedule ${game.emoji} ${game.label}`);

    const dateInput = new TextInputBuilder()
      .setCustomId('date')
      .setLabel('Date (today, tomorrow, friday, 03/25/26)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. today, tomorrow, friday, 03/25/26')
      .setRequired(true);

    const timeInput = new TextInputBuilder()
      .setCustomId('time')
      .setLabel('Time (e.g. 8pm, 8:30pm, 9am)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 8pm, 8:30pm, 9am')
      .setRequired(true);

    const timezoneInput = new TextInputBuilder()
      .setCustomId('timezone')
      .setLabel('Timezone — PT, ET, CT, MT or PST, EST, UTC')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. PT, ET, CT, MT')
      .setRequired(true);

    const maxInput = new TextInputBuilder()
      .setCustomId('max_players')
      .setLabel(`Max players (default: ${game.maxPlayers}, max: ${game.maxPlayers})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(String(game.maxPlayers))
      .setRequired(false);

    const noteInput = new TextInputBuilder()
      .setCustomId('note')
      .setLabel('Note (optional — rank req, mode, etc.)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const inviteInput = new TextInputBuilder()
      .setCustomId('invites')
      .setLabel('Invite friends (their Discord user IDs)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 123456789 987654321 (optional)')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(timezoneInput),
      new ActionRowBuilder().addComponents(noteInput),
      new ActionRowBuilder().addComponents(inviteInput),
    );

    await interaction.showModal(modal);
  }

  // ── Modal submit ──
  if (interaction.isModalSubmit() && interaction.customId.startsWith('schedule_modal_')) {
    const gameName = interaction.customId.replace('schedule_modal_', '');
    const game = GAMES[gameName] || GAMES.other;

    const dateRaw     = interaction.fields.getTextInputValue('date').trim();
    const timezone   = interaction.fields.getTextInputValue('timezone').trim() || 'UTC';
    const date        = parseFlexibleDate(dateRaw, timezone);
    const timeRaw     = interaction.fields.getTextInputValue('time').trim();
    const time        = parseFlexibleTime(timeRaw);
    const note       = interaction.fields.getTextInputValue('note').trim();
    const inviteRaw  = interaction.fields.getTextInputValue('invites').trim();
    const maxPlayers = game.maxPlayers;

    // Parse invited user IDs from the invite field and auto-add them
    const invitedIds = inviteRaw
      ? [...inviteRaw.matchAll(/\d{17,19}/g)].map(m => m[0]).filter(id => id !== interaction.user.id)
      : [];

    const id = sessionCounter++;
    const session = {
      id,
      game: gameName,
      date,
      time,
      timezone,
      note,
      maxPlayers,
      hostId:  interaction.user.id,
      hostTag: interaction.user.tag,
      players: [interaction.user.id, ...invitedIds], // host + invited friends auto-join
      channelId: interaction.channelId,
      messageId: null,
    };

    sessions.set(id, session);

    // Build invite ping string
    const invitePing = invitedIds.length > 0
      ? `📣 Hey ${invitedIds.map(id => `<@${id}>`).join(' ')} — you've been invited to a game session!`
      : '';

    await interaction.deferReply();
    const reply = await interaction.editReply({
      content: `🎮 Session created! Click **Join** below to sign up.${invitePing ? '\n' + invitePing : ''}`,
      embeds: [buildSessionEmbed(session)],
      components: [buildSessionButtons(session)],
    });

    session.messageId = reply.id;
  }

  // ── Join button ──
  if (interaction.isButton() && interaction.customId.startsWith('join_')) {
    const id = parseInt(interaction.customId.replace('join_', ''), 10);
    const session = sessions.get(id);
    if (!session) return interaction.reply({ content: 'Session not found.', ephemeral: true });

    if (session.players.includes(interaction.user.id)) {
      return interaction.reply({ content: 'You\'re already in this session!', ephemeral: true });
    }
    if (session.players.length >= session.maxPlayers) {
      return interaction.reply({ content: 'This session is full!', ephemeral: true });
    }

    session.players.push(interaction.user.id);
    await interaction.reply({ content: `✅ You joined the session! See you ${session.date} at ${session.time} ${session.timezone}.`, ephemeral: true });
    await refreshSessionMessage(session);
  }

  // ── Leave button ──
  if (interaction.isButton() && interaction.customId.startsWith('leave_')) {
    const id = parseInt(interaction.customId.replace('leave_', ''), 10);
    const session = sessions.get(id);
    if (!session) return interaction.reply({ content: 'Session not found.', ephemeral: true });

    const idx = session.players.indexOf(interaction.user.id);
    if (idx === -1) return interaction.reply({ content: 'You\'re not in this session.', ephemeral: true });

    session.players.splice(idx, 1);
    await interaction.reply({ content: '👋 You left the session.', ephemeral: true });
    await refreshSessionMessage(session);
  }

  // ── Invite button ──
  if (interaction.isButton() && interaction.customId.startsWith('invite_')) {
    const id = parseInt(interaction.customId.replace('invite_', ''), 10);
    const session = sessions.get(id);
    if (!session) return interaction.reply({ content: 'Session not found.', ephemeral: true });

    return interaction.reply({
      content: 'To invite friends, type this in the channel:
!invite @friend1 @friend2',
      ephemeral: true,
    });
  }

  // ── Cancel button ──
  if (interaction.isButton() && interaction.customId.startsWith('cancel_')) {
    const id = parseInt(interaction.customId.replace('cancel_', ''), 10);
    const session = sessions.get(id);
    if (!session) return interaction.reply({ content: 'Session not found.', ephemeral: true });
    if (session.hostId !== interaction.user.id) {
      return interaction.reply({ content: 'Only the host can cancel this session.', ephemeral: true });
    }

    sessions.delete(id);
    const game = GAMES[session.game] || GAMES.other;
    await interaction.update({
      content: '',
      embeds: [new EmbedBuilder()
        .setTitle(`❌ Session #${id} Cancelled`)
        .setColor(0xFF0000)
        .setDescription(`The **${game.label}** session on **${session.date} at ${session.time}** was cancelled by the host.`)],
      components: [],
    });
  }
});

// ─── Start the bot ────────────────────────────────────────────
client.login(BOT_TOKEN);
