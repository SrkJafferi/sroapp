// Operator input only: no echo, shell history, clipboard or credential files.
export function privateTerminalInput(label, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== 'function')
    return Promise.reject(Error('An operator-controlled interactive terminal is required.'));
  output.write(label);
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (cancelled) => {
      input.off('data', data);
      input.setRawMode(wasRaw);
      // This helper owns terminal reads. Leaving an initially flowing TTY resumed
      // keeps Node alive after completion/failure and drops input between prompts.
      input.pause();
      output.write('\n');
      const result = value;
      value = '';
      if (cancelled) reject(Error('Operator cancelled private entry.'));
      else resolve(result);
    };
    const data = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          finish(true);
          return;
        }
        if (char === '\r' || char === '\n') {
          finish(false);
          return;
        }
        if (char === '\b' || char === '\u007f') value = [...value].slice(0, -1).join('');
        else if (char >= ' ' && value.length < 256) value += char;
      }
    };
    input.on('data', data);
  });
}
