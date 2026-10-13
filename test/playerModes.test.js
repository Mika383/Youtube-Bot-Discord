const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayerService } = require('../src/services/playerService');

function createService() {
  return createPlayerService({
    youtubeService: {},
    panelService: {
      upsertNowPlayingPanel: async () => null,
    },
    client: null,
  });
}

test('Shuffle and Infinite toggle independently', () => {
  const service = createService();
  const state = service.getGuildState('guild-1');
  state.current = { url: 'https://example.com/1', title: 'One', requestedBy: 'tester' };
  state.tracks = [{ url: 'https://example.com/2', title: 'Two', requestedBy: 'tester' }];

  assert.equal(service.toggleShuffleMode(state), true);
  assert.equal(state.shuffleMode, true);
  assert.equal(state.queueInfiniteMode, false);

  assert.equal(service.toggleInfiniteMode(state), true);
  assert.equal(state.shuffleMode, true);
  assert.equal(state.queueInfiniteMode, true);

  assert.equal(service.toggleShuffleMode(state), false);
  assert.equal(state.shuffleMode, false);
  assert.equal(state.queueInfiniteMode, true);
});

test('Mutating controls require the same voice channel', () => {
  const service = createService();
  const state = service.getGuildState('guild-2');
  state.connection = { joinConfig: { channelId: 'voice-a' } };

  assert.doesNotThrow(() => service.requireSameVoiceChannel({
    member: { voice: { channelId: 'voice-a' } },
    user: { id: 'user-1' },
  }, state));

  assert.throws(() => service.requireSameVoiceChannel({
    member: { voice: { channelId: 'voice-b' } },
    user: { id: 'user-1' },
  }, state), /cùng voice channel/);
});
