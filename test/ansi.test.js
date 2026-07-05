const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnsi, stripAnsi } = require('../public/ansi');

test('parses Minecraft ANSI colors and text decorations', () => {
  const input = '\x1b[38;5;9mIncorrect\x1b[0m '
    + '\x1b[38;5;7mbluemap \x1b[4m\x1b[38;5;9mrelaod\x1b[0m';
  const segments = parseAnsi(input);

  assert.equal(stripAnsi(input), 'Incorrect bluemap relaod');
  assert.ok(segments.some((segment) => segment.text === 'Incorrect' && segment.color === '#f14c4c'));
  assert.ok(segments.some((segment) => (
    segment.text === 'relaod'
    && segment.color === '#f14c4c'
    && segment.underline
  )));
});

test('keeps HTML as plain text data', () => {
  const segments = parseAnsi('\x1b[31m<script>alert(1)</script>\x1b[0m');
  assert.equal(segments[0].text, '<script>alert(1)</script>');
});
