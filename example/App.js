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

    // Custom error handler
    /* app.error((err, req, res) => {
      res.status(500).json({ error: err.message });
    }); */

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
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#e94560',
    marginBottom: 8,
  },
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
  hint: {
    color: '#888',
    marginTop: 8,
    fontSize: 13,
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#16213e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  logTitle: {
    color: '#e94560',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 10,
  },
  logScroll: {
    flex: 1,
  },
  logEmpty: {
    color: '#555',
    fontStyle: 'italic',
  },
  logEntry: {
    color: '#ccc',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
});
