import TcpSocket from 'react-native-tcp-socket';
import { Server } from './server.js';
import { Router } from './router.js';
import { Response } from './response.js';
import { cors } from './cors.js';

export { Server, Router, Response, cors };

// const app = createServer();
// app.get('/', (req, res) => res.json({ hello: 'world' }));
// app.listen(8080);
export default function createServer(options) {
  return new Server(TcpSocket, options);
}
