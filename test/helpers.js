// Fakes standing in for react-native-tcp-socket so the server runs in Node.

export class FakeSocket {
  constructor() {
    this.writes = [];
    this.destroyed = false;
    this.remoteAddress = '192.168.1.50';
    this._listeners = {};
  }

  on(event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
  }

  emit(event, ...args) {
    (this._listeners[event] || []).forEach((cb) => cb(...args));
  }

  write(data, encoding, cb) {
    this.writes.push({ data, encoding });
    if (cb) cb();
  }

  destroy() {
    this.destroyed = true;
  }
}

export class FakeTcp {
  constructor() {
    this.servers = [];
  }

  createServer(onConnection) {
    const server = {
      onConnection,
      listenOptions: null,
      closed: false,
      listen(opts, cb) {
        this.listenOptions = opts;
        if (cb) cb();
      },
      on() {},
      close() {
        this.closed = true;
      },
    };
    this.servers.push(server);
    return server;
  }
}

// Open a fake connection to a listening app and push raw request chunks.
// Returns the socket after handlers (incl. async ones) had a chance to run.
export async function send(tcp, chunks) {
  const socket = new FakeSocket();
  tcp.servers.at(-1).onConnection(socket);
  for (const chunk of chunks) {
    socket.emit('data', chunk);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  return socket;
}

export function parseResponse(socket) {
  const raw = socket.writes.map((w) => w.data).join('');
  const headerEnd = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd + 4);
  const [statusLine, ...headerLines] = head.split('\r\n');
  const status = parseInt(statusLine.split(' ')[1], 10);
  const headers = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { status, statusLine, headers, body, raw };
}
