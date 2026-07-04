const readline = require('node:readline');

console.log('[Server thread/INFO]: Starting minecraft server version Test');
console.log('[Server thread/INFO]: Done (0.123s)! For help, type "help"');

const input = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

input.on('line', (line) => {
  if (line === 'stop') {
    console.log('[Server thread/INFO]: Saving worlds');
    console.log('[Server thread/INFO]: ThreadedAnvilChunkStorage: All dimensions are saved');
    input.close();
    setTimeout(() => process.exit(0), 20);
    return;
  }
  console.log(`[Server thread/INFO]: Executed command: ${line}`);
});
