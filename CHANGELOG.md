# Changelog

## 0.1.0

Initial release.

- Express-style routing: `get/post/put/delete/patch/all`, route params, query strings
- Middleware: global, path-prefixed, per-route, async support, custom error handler
- Mountable `Router`
- `cors()` middleware with automatic OPTIONS preflight handling
- JSON, text, HTML, redirect and binary file responses (`sendFile`/`download`)
- Dependency-free file serving via file-like objects (works with expo-file-system and react-native-fs)
- Request bodies buffered to the declared `Content-Length` (bodies split across TCP packets are handled correctly)
- Crash-safe parsing: malformed requests answer `400`, malformed percent-encoding is passed through as-is
- Configurable `requestTimeout` for incomplete connections
- TypeScript definitions
