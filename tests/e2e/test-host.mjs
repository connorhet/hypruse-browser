// A stand-in for `hypruse browser-host`, used only by the end to end tests. Chrome starts it
// through native messaging; it relays Chrome's length-prefixed frames to the unix socket named
// by HYPRUSE_TEST_HOST_SOCKET as JSON lines, and lines from the socket back as frames.
import net from 'node:net';

const socketPath = process.env.HYPRUSE_TEST_HOST_SOCKET;
if (!socketPath) process.exit(1);

const socket = net.createConnection(socketPath);
let pending = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32LE(0);
    if (pending.length < 4 + length) break;
    socket.write(`${pending.subarray(4, 4 + length).toString('utf8')}\n`);
    pending = pending.subarray(4 + length);
  }
});
process.stdin.on('end', () => socket.end());

let lines = '';
socket.on('data', (chunk) => {
  lines += chunk.toString('utf8');
  let at;
  while ((at = lines.indexOf('\n')) !== -1) {
    const body = Buffer.from(lines.slice(0, at), 'utf8');
    lines = lines.slice(at + 1);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    process.stdout.write(Buffer.concat([header, body]));
  }
});
socket.on('close', () => process.exit(0));
socket.on('error', () => process.exit(1));
