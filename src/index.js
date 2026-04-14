require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const { createNowPlayingPanelService } = require('./services/nowPlayingPanel');
const { createPlayerService } = require('./services/playerService');
const youtubeService = require('./services/youtubeService');
const playlistStore = require('./playlistStore');
const { createPlaylistPanelService } = require('./services/playlistPanelService');
const { createInteractionHandler } = require('./handlers/interactionHandler');
const { getCommandDefinitions } = require('./commands/registerCommands');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

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

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`Slash commands registered for guild ${guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('Global slash commands registered (can take time to propagate).');
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, interactionHandler.handle);

globalThis.__musicQueue = playerService.queue;

client.login(token);
