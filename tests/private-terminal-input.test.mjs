import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { privateTerminalInput } from '../scripts/private-terminal-input.mjs';
function terminal() {
  const input = new EventEmitter();
  Object.assign(input, {
    isTTY: true,
    isRaw: false,
    setRawMode(v) {
      this.isRaw = v;
    },
    isPaused() {
      return true;
    },
    pause() {},
    resume() {},
  });
  let output = '';
  return {
    input,
    output: {
      write(s) {
        output += s;
      },
    },
    text: () => output,
  };
}
test('hidden entry handles backspace, restores raw mode and never echoes input', async () => {
  const t = terminal();
  const p = privateTerminalInput('Private: ', t.input, t.output);
  t.input.emit('data', Buffer.from('non-secret-sentinelX\b\r'));
  assert.equal(await p, 'non-secret-sentinel');
  assert.equal(t.text(), 'Private: \n');
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.listenerCount('data'), 0);
});
test('cancellation clears listeners without echoing input', async () => {
  const t = terminal();
  const p = privateTerminalInput('Private: ', t.input, t.output);
  t.input.emit('data', Buffer.from('non-secret-sentinel\u0003'));
  await assert.rejects(p, /cancelled/);
  assert.equal(t.text(), 'Private: \n');
  assert.equal(t.input.listenerCount('data'), 0);
  assert.equal(t.input.isRaw, false);
});
test('noninteractive input is rejected before reading credentials', async () => {
  await assert.rejects(
    privateTerminalInput(
      'Private: ',
      { isTTY: false },
      {
        write() {
          assert.fail();
        },
      },
    ),
    /interactive terminal/,
  );
});

test('an initially flowing terminal is paused on success and cancellation', async () => {
  for (const ending of ['\r', '\u0003']) {
    const t = terminal();
    let paused = false;
    t.input.isPaused = () => false;
    t.input.pause = () => {
      paused = true;
    };
    const value = privateTerminalInput('Private: ', t.input, t.output);
    t.input.emit('data', Buffer.from('non-secret-sentinel' + ending));
    if (ending === '\r') await value;
    else await assert.rejects(value, /cancelled/);
    assert.equal(paused, true);
    assert.equal(t.text(), 'Private: \n');
  }
});
