const test = require('node:test');
const assert = require('node:assert/strict');
const { navigate } = require('../public/command-history');

test('navigates command history and restores the draft', () => {
  const history = ['list', 'bluemap reload'];
  const previous = navigate({
    history,
    index: -1,
    draft: '',
    current: 'say ',
    direction: 'up',
  });
  assert.deepEqual(previous, {
    changed: true,
    index: 1,
    draft: 'say ',
    value: 'bluemap reload',
  });

  const older = navigate({ history, ...previous, current: previous.value, direction: 'up' });
  assert.equal(older.value, 'list');
  const newer = navigate({ history, ...older, current: older.value, direction: 'down' });
  assert.equal(newer.value, 'bluemap reload');
  const restored = navigate({ history, ...newer, current: newer.value, direction: 'down' });
  assert.equal(restored.value, 'say ');
  assert.equal(restored.index, -1);
});
