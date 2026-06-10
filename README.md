# react-native-pocket-server

A tiny Express-style HTTP server that runs **inside your React Native app**. Turn any phone into a web server: routing, middleware, routers, CORS, JSON APIs and file serving — with **zero runtime dependencies** (just one peer dependency on [`react-native-tcp-socket`](https://github.com/Rapsssito/react-native-tcp-socket)).

```js
import createServer from 'react-native-pocket-server';

const app = createServer();

app.get('/', (req, res) => {
  res.json({ hello: 'from my phone!' });
});

app.listen(8080);
```

Any device on the same network can now `curl http://<phone-ip>:8080/`.

## Why?

There was no maintained, batteries-included way to run an HTTP server with an Express-like API inside React Native. Use cases:

- **Device-to-device transfer** — share files or data between phones over LAN, no cloud.
- **Companion web UI** — control your app from a laptop browser on the same Wi-Fi.
- **Local REST API** — let desktop tools, scripts or IoT devices talk to your app.
- **Debugging/inspection** — expose app state over HTTP while developing.

## Installation

```sh
npm install react-native-pocket-server react-native-tcp-socket
```

`react-native-tcp-socket` contains native code, so:

- **Expo**: you need a [development build](https://docs.expo.dev/develop/development-builds/introduction/) (`npx expo run:android` / `run:ios`). It will **not** work in Expo Go.
- **Bare React Native**: run `pod install` for iOS as usual.

## Quick start

```js
import createServer, { Router, cors } from 'react-native-pocket-server';

const app = createServer();

// Global middleware
app.use(cors());

// Routes
app.get('/ping', (req, res) => res.json({ pong: true }));

// Route params + query: GET /users/42?verbose=1
app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id, verbose: req.query.verbose });
});

// JSON body: POST /echo  {"msg":"hi"}
app.post('/echo', (req, res) => res.json({ youSent: req.json }));

app.listen(8080, () => console.log('listening'));

// Later (e.g. component unmount):
app.close();
```

Show the user the server's address with [`expo-network`](https://docs.expo.dev/versions/latest/sdk/network/):

```js
import * as Network from 'expo-network';
const ip = await Network.getIpAddressAsync(); // e.g. 192.168.1.42
```

## API

### `createServer(options?)`

| Option | Default | Description |
| --- | --- | --- |
| `requestTimeout` | `10000` | ms to wait for a complete request before dropping the connection |

### Routing

```js
app.get(path, ...middleware, handler)
app.post(path, ...middleware, handler)
app.put(path, ...middleware, handler)
app.delete(path, ...middleware, handler)
app.patch(path, ...middleware, handler)
app.all(path, ...middleware, handler)   // any method
```

Paths support named params (`/users/:id`, `/posts/:year/:slug`). Params are URL-decoded automatically.

### The request object

| Field | Example | Description |
| --- | --- | --- |
| `req.method` | `'GET'` | HTTP method |
| `req.path` | `'/users/42'` | path without query string |
| `req.params` | `{ id: '42' }` | named route params |
| `req.query` | `{ q: 'hi' }` | parsed query string |
| `req.headers` | `{ 'content-type': ... }` | headers, lowercase keys |
| `req.body` | `'{"a":1}'` | raw body text |
| `req.json` | `{ a: 1 }` | parsed body when `Content-Type: application/json` |
| `req.ip` | `'192.168.1.50'` | client address |

Middleware can attach anything extra (e.g. `req.user`).

### The response object

```js
res.status(404)                  // chainable
res.header('X-Custom', 'v')      // chainable (alias: res.set)
res.json({ ok: true })
res.send('plain text')           // objects are forwarded to res.json()
res.html('<h1>Hi</h1>')
res.redirect('/login')           // 302, or res.redirect(301, '/new')
res.end()                        // empty response
await res.sendFile(file)         // see "Serving files"
await res.download(file, name)   // sendFile with Content-Disposition: attachment
```

### Middleware

Works like Express — call `next()` to continue, send a response to stop the chain, `next(err)` or `throw` to reach the error handler. Async handlers are fully supported.

```js
// Global
app.use((req, res, next) => { console.log(req.path); next(); });

// Limited to a path prefix
app.use('/admin', (req, res, next) => { ...; next(); });

// Per-route (run before the handler)
function auth(req, res, next) {
  if (req.headers['authorization'] !== 'Bearer secret') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = { name: 'Jane' };
  next();
}
app.get('/private', auth, (req, res) => res.json({ user: req.user }));
```

### Routers

```js
import { Router } from 'react-native-pocket-server';

const api = new Router();
api.get('/users', (req, res) => res.json({ users: [] }));
api.get('/users/:id', (req, res) => res.json({ id: req.params.id }));

app.use('/api', api);  // GET /api/users, GET /api/users/:id
app.use(api);          // or mount at the root
```

> Routes are copied into the server when `app.use()` is called — add all routes to the router **before** mounting it.

### CORS

```js
import { cors } from 'react-native-pocket-server';

app.use(cors()); // allow everything (default)

app.use(cors({
  origin: 'https://myapp.com',
  methods: ['GET', 'POST'],
  headers: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));
```

`OPTIONS` preflight requests are answered automatically with `204` (browsers require this). Pass `{ preflight: false }` to handle `OPTIONS` yourself.

### Serving files

`res.sendFile()` accepts any object with `{ exists, size, base64() }`. The `File` class from [`expo-file-system`](https://docs.expo.dev/versions/latest/sdk/filesystem/) matches this shape exactly:

```js
import { File, Paths } from 'expo-file-system';

app.get('/photo', async (req, res) => {
  await res.sendFile(new File(Paths.document, 'photo.png'));
});

app.get('/report', async (req, res) => {
  await res.download(new File(Paths.document, 'report.pdf'), 'monthly-report.pdf');
});
```

MIME type is detected from the extension (override with `options.contentType`). Missing files get a `404` automatically.

Not using Expo? Pass a small adapter — example with `react-native-fs`:

```js
import RNFS from 'react-native-fs';

async function rnfsFile(path) {
  const exists = await RNFS.exists(path);
  return {
    uri: path,
    exists,
    size: exists ? (await RNFS.stat(path)).size : null,
    base64: () => RNFS.readFile(path, 'base64'),
  };
}

app.get('/photo', async (req, res) => {
  await res.sendFile(await rnfsFile(`${RNFS.DocumentDirectoryPath}/photo.png`));
});
```

### Error handling

```js
app.error((err, req, res) => {
  res.status(500).json({ error: err.message });
});
```

Without a custom handler, errors produce `500 {"error":"Internal Server Error"}`. Malformed requests get a `400` instead of crashing the app.

### Logging

```js
app.onLog((line) => console.log(line)); // 'GET /users/42', socket errors, ...
```

### `app.listen(port, host?, callback?)` / `app.close()`

Binds to `0.0.0.0` by default (reachable from the network). Pass `'127.0.0.1'` to only accept connections from the device itself. Call `app.close()` when your component unmounts.

## Security notes

You are opening a port on the user's device — treat everything that arrives as untrusted:

- **Anyone on the same network can reach the server.** Add authentication middleware (see example above) for anything sensitive.
- **Sanitize file names** before touching the file system. Reject names containing `/`, `\` or `..`:

  ```js
  app.get('/files/:name', async (req, res) => {
    const { name } = req.params;
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }
    await res.sendFile(new File(Paths.document, name));
  });
  ```

- There is **no TLS** — traffic is plain HTTP on the local network.

## Limitations (by design — this is a pocket server)

- Request bodies are treated as **text** (JSON, form data as text, etc.). Binary uploads / multipart are not supported; responses *can* be binary (`sendFile`).
- One request per connection (`Connection: close`) — no keep-alive, no HTTP/2.
- Files are read fully into memory to be sent — fine for icons, documents and photos; not meant for multi-GB video streaming.

## Example app 

A full Expo example with auth middleware, role checks, file upload/download and a live request log lives in [`example/`](example):

```sh
cd example
npm install
npx expo run:android   # or run:ios
```

### Complete example

The full `App.js` from the example app — a working server with public, authenticated and admin routes, query/route params, file serving, upload, a mounted router, and a live request log on screen:

<details>
<summary><strong>Show the complete App.js</strong></summary>

```jsx
import { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Network from 'expo-network';
import { File as FSFile, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';
import createServer, { Router, cors } from 'react-native-pocket-server';

const PORT = 8080;

// --- Middleware examples ---

// Auth middleware: checks for Bearer token in Authorization header
function auth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  // Simulate token validation — replace with your own logic
  if (token === 'secret123') {
    req.user = { id: 1, name: 'John', role: 'admin' };
  } else if (token === 'user456') {
    req.user = { id: 2, name: 'Jane', role: 'user' };
  } else {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

// Role middleware factory: returns middleware that checks user role
function role(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// Only allow plain file names — no separators or parent-directory segments,
// so requests can't escape the document directory
function isSafeFileName(name) {
  return !!name && !name.includes('/') && !name.includes('\\') && !name.includes('..');
}

export default function App() {
  const [ip, setIp] = useState('loading...');
  const [logs, setLogs] = useState([]);
  const serverRef = useRef(null);

  const addLog = (msg) => {
    setLogs((prev) => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    Network.getIpAddressAsync().then((addr) => setIp(addr || 'unknown'));

    const app = createServer();
    app.onLog(addLog);

    // Global middleware: CORS with automatic OPTIONS preflight handling
    app.use(cors());

    // Public routes (no auth)
    app.get('/', (req, res) => {
      res.json({ message: 'Hello from React Native server!' });
    });

    app.get('/ping', (req, res) => {
      res.json({ pong: true, timestamp: Date.now() });
    });

    // Protected route: requires auth
    app.get('/profile', auth, (req, res) => {
      res.json({ user: req.user });
    });

    // Admin-only route: requires auth + admin role
    app.get('/admin', auth, role('admin'), (req, res) => {
      res.json({ message: 'Welcome admin', user: req.user });
    });

    // Protected POST with auth
    app.post('/echo', auth, (req, res) => {
      res.json({ echo: req.body, json: req.json, user: req.user });
    });

    // --- Query params example ---
    // GET /search?q=hello&limit=10
    app.get('/search', (req, res) => {
      const { q, limit, page } = req.query;
      res.json({
        query: q || null,
        limit: limit ? parseInt(limit) : 20,
        page: page ? parseInt(page) : 1,
      });
    });

    // --- Route params examples ---
    // GET /users/42
    app.get('/users/:id', (req, res) => {
      res.json({ userId: req.params.id });
    });

    // GET /posts/2024/my-first-post
    app.get('/posts/:year/:slug', (req, res) => {
      res.json({ year: req.params.year, slug: req.params.slug });
    });

    // Params + query combined: GET /products/shoes?color=red&size=42
    app.get('/products/:category', (req, res) => {
      res.json({
        category: req.params.category,
        filters: req.query,
      });
    });

    // --- File serving examples ---

    // Serve the app icon as an image (inline in browser)
    app.get('/icon', async (req, res) => {
      const asset = Asset.fromModule(require('./assets/icon.png'));
      await asset.downloadAsync();
      await res.sendFile(new FSFile(asset.localUri));
    });

    // Download the app icon
    app.get('/icon/download', async (req, res) => {
      const asset = Asset.fromModule(require('./assets/icon.png'));
      await asset.downloadAsync();
      await res.download(new FSFile(asset.localUri), 'app-icon.png');
    });

    // Serve any file from the app's document directory
    // e.g. /files/mydata.json
    app.get('/files/:name', async (req, res) => {
      if (!isSafeFileName(req.params.name)) {
        return res.status(400).json({ error: 'Invalid file name' });
      }
      const file = new FSFile(Paths.document, req.params.name);
      await res.sendFile(file);
    });

    // Upload a JSON file to the device (save to document directory)
    app.post('/upload', auth, async (req, res) => {
      if (!req.json || !req.json.fileName || !req.json.content) {
        return res.status(400).json({ error: 'Send { fileName, content } as JSON' });
      }
      if (!isSafeFileName(req.json.fileName)) {
        return res.status(400).json({ error: 'Invalid file name' });
      }
      const file = new FSFile(Paths.document, req.json.fileName);
      file.create({ overwrite: true });
      file.write(req.json.content);
      res.status(201).json({ saved: req.json.fileName, path: file.uri });
    });

    // List files in the document directory
    app.get('/files', (req, res) => {
      const entries = Paths.document.list();
      const files = entries.map((e) => e.uri.split('/').pop());
      res.json({ files });
    });

    // Router example: group routes under /api
    const api = new Router();
    api.get('/users', (req, res) => {
      res.json({ users: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }] });
    });
    api.get('/users/:id', (req, res) => {
      res.json({ userId: req.params.id });
    });
    app.use('/api', api);

    app.listen(PORT, () => {
      addLog(`Server listening on port ${PORT}`);
    });

    serverRef.current = app;
    return () => app.close();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>React Native Pocket Server</Text>
        <Text style={styles.ip}>http://{ip}:{PORT}</Text>
        <Text style={styles.hint}>Access this URL from another device on the same network</Text>
      </View>
      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>Request Log</Text>
        <ScrollView style={styles.logScroll}>
          {logs.length === 0 ? (
            <Text style={styles.logEmpty}>Waiting for requests...</Text>
          ) : (
            logs.map((log, i) => (
              <Text key={i} style={styles.logEntry}>{log}</Text>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingTop: 60 },
  header: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#e94560', marginBottom: 8 },
  ip: {
    fontSize: 20,
    fontWeight: '600',
    backgroundColor: '#e94560',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
    color: '#fff',
  },
  hint: { color: '#888', marginTop: 8, fontSize: 13 },
  logContainer: {
    flex: 1,
    backgroundColor: '#16213e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  logTitle: { color: '#e94560', fontWeight: 'bold', fontSize: 16, marginBottom: 10 },
  logScroll: { flex: 1 },
  logEmpty: { color: '#555', fontStyle: 'italic' },
  logEntry: { color: '#ccc', fontSize: 13, fontFamily: 'monospace', marginBottom: 4 },
});
```

</details>

Try it from another device on the same network:

```sh
curl http://<phone-ip>:8080/ping
curl http://<phone-ip>:8080/users/42
curl http://<phone-ip>:8080/profile -H "Authorization: Bearer secret123"
curl http://<phone-ip>:8080/upload -X POST \
  -H "Authorization: Bearer secret123" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"note.txt","content":"hello from my laptop"}'
curl http://<phone-ip>:8080/files/note.txt
```

## Contributing

Issues and PRs welcome! The core is dependency-free JavaScript; run the test suite with:

```sh
npm test
```

## License

[MIT](LICENSE)
