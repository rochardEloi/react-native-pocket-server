import { byteLength, getMimeType, getFileName } from './http.js';

const STATUS_TEXTS = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
  413: 'Payload Too Large', 415: 'Unsupported Media Type',
  422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable',
};

// Delay before destroying the socket, giving the TCP stack time to flush.
const FLUSH_DELAY_TEXT = 100;
const FLUSH_DELAY_BINARY = 150;

export class Response {
  constructor(socket) {
    this._socket = socket;
    this._statusCode = 200;
    this._statusText = 'OK';
    this._headers = { Connection: 'close' };
    this._sent = false;
  }

  get sent() {
    return this._sent;
  }

  status(code) {
    this._statusCode = code;
    this._statusText = STATUS_TEXTS[code] || 'OK';
    return this;
  }

  header(key, value) {
    this._headers[key] = value;
    return this;
  }

  set(key, value) {
    return this.header(key, value);
  }

  json(data) {
    const body = JSON.stringify(data);
    this._headers['Content-Type'] = 'application/json';
    this._headers['Content-Length'] = byteLength(body);
    this._send(body);
    return this;
  }

  send(body) {
    if (typeof body === 'object' && body !== null) return this.json(body);
    const str = String(body);
    if (!this._headers['Content-Type']) {
      this._headers['Content-Type'] = 'text/plain';
    }
    this._headers['Content-Length'] = byteLength(str);
    this._send(str);
    return this;
  }

  html(body) {
    this._headers['Content-Type'] = 'text/html';
    this._headers['Content-Length'] = byteLength(body);
    this._send(body);
    return this;
  }

  // res.redirect('/somewhere') — 302
  // res.redirect(301, '/somewhere')
  redirect(code, url) {
    if (typeof code === 'string') {
      url = code;
      code = 302;
    }
    this.status(code).header('Location', url);
    this._headers['Content-Length'] = 0;
    this._send('');
    return this;
  }

  end() {
    if (!('Content-Length' in this._headers)) {
      this._headers['Content-Length'] = 0;
    }
    this._send('');
    return this;
  }

  // Send a file as the response body. Accepts any object exposing
  // { exists, size, base64() } plus a uri or name for MIME detection —
  // expo-file-system's File matches this shape exactly, and adapters for
  // react-native-fs are a one-liner (see README).
  //
  //   await res.sendFile(new File(Paths.document, 'photo.png'))
  //   await res.sendFile(file, { contentType: 'image/png', download: true })
  async sendFile(file, options = {}) {
    if (this._sent) return this;
    try {
      if (!file || typeof file.base64 !== 'function') {
        throw new Error(
          'res.sendFile() expects a file object with exists, size and base64() — e.g. an expo-file-system File instance'
        );
      }
      if (!file.exists) {
        this.status(404).json({ error: 'File not found' });
        return this;
      }

      const sourceName = file.uri || file.name || 'file';
      const mime = options.contentType || getMimeType(sourceName);
      const fileName = options.fileName || getFileName(sourceName);
      const disposition =
        options.disposition === 'attachment' || options.download ? 'attachment' : 'inline';

      this._headers['Content-Type'] = mime;
      if (file.size != null) this._headers['Content-Length'] = file.size;
      this._headers['Content-Disposition'] = `${disposition}; filename="${fileName}"`;

      const base64 = await file.base64();
      this._sendBinary(base64);
    } catch (e) {
      if (!this._sent) this.status(500).json({ error: 'Failed to read file: ' + e.message });
    }
    return this;
  }

  // Send a file as a download (Content-Disposition: attachment)
  //   await res.download(file)
  //   await res.download(file, 'custom-name.pdf')
  async download(file, fileName) {
    const name =
      fileName || getFileName((file && (file.uri || file.name)) || 'file');
    return this.sendFile(file, { download: true, fileName: name });
  }

  _send(body) {
    if (this._sent) return;
    this._sent = true;

    const headerLines = Object.entries(this._headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');

    const raw = `HTTP/1.1 ${this._statusCode} ${this._statusText}\r\n${headerLines}\r\n\r\n${body}`;

    this._socket.write(raw, 'utf8', () => {
      setTimeout(() => this._socket.destroy(), FLUSH_DELAY_TEXT);
    });
  }

  _sendBinary(base64Data) {
    if (this._sent) return;
    this._sent = true;

    const headerLines = Object.entries(this._headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');

    const headerStr = `HTTP/1.1 ${this._statusCode} ${this._statusText}\r\n${headerLines}\r\n\r\n`;

    // Headers go out as text, then the body as base64-decoded binary
    this._socket.write(headerStr, 'utf8', () => {
      this._socket.write(base64Data, 'base64', () => {
        setTimeout(() => this._socket.destroy(), FLUSH_DELAY_BINARY);
      });
    });
  }
}
