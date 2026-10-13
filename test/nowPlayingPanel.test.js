const test = require('node:test');
const assert = require('node:assert/strict');
const { ButtonStyle } = require('discord.js');
const {
  BTN_INFINITE,
  BTN_SHUFFLE,
  buildControlsRows,
  buildNowPlayingEmbed,
} = require('../src/services/nowPlayingPanel');

function createState(overrides = {}) {
  return {
    current: {
      title: 'Test track',
      durationSec: 180,
      requestedBy: 'tester',
      thumbnail: null,
    },
    tracks: [{ title: 'Next track' }],
    history: [],
    isPaused: false,
    shuffleMode: false,
    queueInfiniteMode: false,
    playlistLoopTemplate: null,
    ...overrides,
  };
}

test('Now Playing uses seven icon-only controls', () => {
  const components = buildControlsRows(createState()).flatMap((row) => row.toJSON().components);
  assert.equal(components.length, 7);
  for (const component of components) {
    assert.equal(component.label, undefined);
    assert.ok(component.emoji?.name);
  }
});

test('Shuffle and Infinite colors reflect independent state', () => {
  const state = createState({ shuffleMode: true, queueInfiniteMode: false });
  const components = buildControlsRows(state).flatMap((row) => row.toJSON().components);
  const shuffle = components.find((component) => component.custom_id === BTN_SHUFFLE);
  const infinite = components.find((component) => component.custom_id === BTN_INFINITE);
  assert.equal(shuffle.style, ButtonStyle.Success);
  assert.equal(infinite.style, ButtonStyle.Secondary);

  const fields = buildNowPlayingEmbed(state).toJSON().fields;
  assert.equal(fields.find((field) => field.name.includes('Shuffle')).value, 'BẬT');
  assert.equal(fields.find((field) => field.name.includes('Infinite')).value, 'TẮT');
});
