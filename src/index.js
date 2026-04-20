require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const { createNowPlayingPanelService } = require('./services/nowPlayingPanel');
const { createPlayerService } = require('./services/playerService');
const youtubeService = require('./services/youtubeService');
const playlistStore = require('./playlistStore');
const { createPlaylistPanelService } = require('./services/playlistPanelService');
const { createInteractionHandler } = require('./handlers/interactionHandler');
const { getCommandDefinitions } = require('./commands/registerCommands');
const { createLogger } = require('./utils/logger');

const logger = createLogger('app');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  logger.error('Missing required environment variables.', {
    hasToken: Boolean(token),
    hasClientId: Boolean(clientId),
    hasGuildId: Boolean(guildId),
  });
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const panelService = createNowPlayingPanelService(client);
const playerService = createPlayerService({ youtubeService, panelService });
const playlistPanelService = createPlaylistPanelService(playlistStore);
const interactionHandler = createInteractionHandler({
  playerService,
  panelService,
  playlistStore,
  playlistPanelService,
  youtubeService,
});

async function registerCommands() {
  const commands = getCommandDefinitions().map((c) => c.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);
  logger.info('Registering slash commands.', {
    scope: guildId ? 'guild' : 'global',
    guildId: guildId || null,
    commandCount: commands.length,
  });

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    logger.info('Slash commands registered for guild.', {
      guildId,
      commandCount: commands.length,
    });
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info('Global slash commands registered.', { commandCount: commands.length });
}

client.once(Events.ClientReady, async (readyClient) => {
  logger.info('Discord client ready.', {
    userTag: readyClient.user.tag,
    userId: readyClient.user.id,
    pid: process.pid,
    nodeVersion: process.version,
    guildRegistration: guildId || 'global',
  });
  await registerCommands();
});

client.on(Events.InteractionCreate, interactionHandler.handle);

client.on(Events.Error, (error) => {
  logger.error('Discord client emitted an error.', { error });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection.', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception.', { error });
});

globalThis.__musicQueue = playerService.queue;

logger.info('Starting Discord bot process.', {
  hasGuildId: Boolean(guildId),
  logLevel: process.env.LOG_LEVEL || 'debug',
});
client.login(token);
