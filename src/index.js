require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queue = new Map();

function getGuildState(guildId) {
  if (!queue.has(guildId)) {
    queue.set(guildId, {
      tracks: [],
      player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }),
      connection: null,
      current: null,
      textChannelId: null,
    });
  }
  return queue.get(guildId);
}

async function playNext(interaction, guildState) {
  const next = guildState.tracks.shift();
  if (!next) {
    guildState.current = null;
    return;
  }

  guildState.current = next;

  const stream = await play.stream(next.url);
  const resource = createAudioResource(stream.stream, { inputType: stream.type });
  guildState.player.play(resource);

  if (interaction && interaction.channel) {
    await interaction.followUp({ content: `🎶 Đang phát: ${next.title}` }).catch(() => null);
  }
}

async function ensureConnection(interaction, guildState) {
  const memberChannel = interaction.member?.voice?.channel;
  if (!memberChannel) {
    throw new Error('Bạn phải vào voice channel trước đã.');
  }

  if (!guildState.connection) {
    guildState.connection = joinVoiceChannel({
      channelId: memberChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    await entersState(guildState.connection, VoiceConnectionStatus.Ready, 20_000);
    guildState.connection.subscribe(guildState.player);
  }

  guildState.textChannelId = interaction.channelId;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('play').setDescription('Phát nhạc từ YouTube URL').addStringOption(o => o.setName('url').setDescription('YouTube URL').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('Bỏ qua bài hiện tại'),
    new SlashCommandBuilder().setName('stop').setDescription('Dừng nhạc và xoá hàng chờ'),
    new SlashCommandBuilder().setName('queue').setDescription('Xem hàng chờ hiện tại'),
    new SlashCommandBuilder().setName('leave').setDescription('Rời voice channel'),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('Slash commands registered.');
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildState = getGuildState(interaction.guildId);

  try {
    if (interaction.commandName === 'play') {
      await interaction.deferReply();
      await ensureConnection(interaction, guildState);

      const url = interaction.options.getString('url', true);
      const info = await play.video_basic_info(url);
      const title = info.video_details.title || url;

      guildState.tracks.push({ url, title });

      if (!guildState.current) {
        await playNext(interaction, guildState);
      } else {
        await interaction.followUp({ content: `➕ Đã thêm vào hàng chờ: ${title}` });
      }
      return;
    }

    if (interaction.commandName === 'skip') {
      if (!guildState.current) {
        await interaction.reply({ content: 'Không có bài nào đang phát.', ephemeral: true });
        return;
      }
      guildState.player.stop();
      await interaction.reply('⏭️ Đã skip bài hiện tại.');
      return;
    }

    if (interaction.commandName === 'stop') {
      guildState.tracks = [];
      guildState.current = null;
      guildState.player.stop();
      guildState.connection?.destroy();
      guildState.connection = null;
      await interaction.reply('⏹️ Đã dừng nhạc và xoá hàng chờ.');
      return;
    }

    if (interaction.commandName === 'queue') {
      const lines = [];
      if (guildState.current) lines.push(`Đang phát: ${guildState.current.title}`);
      if (guildState.tracks.length > 0) {
        lines.push('Hàng chờ:');
        guildState.tracks.slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
      }
      if (lines.length === 0) lines.push('Hàng chờ đang trống.');
      await interaction.reply(lines.join('\n'));
      return;
    }

    if (interaction.commandName === 'leave') {
      guildState.tracks = [];
      guildState.current = null;
      guildState.player.stop();
      guildState.connection?.destroy();
      guildState.connection = null;
      await interaction.reply('👋 Đã rời voice channel.');
      return;
    }
  } catch (error) {
    console.error(error);
    const message = `Lỗi: ${error.message || 'không rõ nguyên nhân'}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message }).catch(() => null);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
    }
  }
});

globalThis.__musicQueue = queue;

for (const guildState of queue.values()) {
  guildState.player.on(AudioPlayerStatus.Idle, () => playNext(null, guildState).catch(console.error));
}

client.login(token);
