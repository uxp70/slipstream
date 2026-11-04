import Peer from 'peerjs';

// Peer-to-peer transport for squad co-op. There is no game server: the public
// PeerJS broker is only used to exchange WebRTC offers, and every packet after
// that travels directly between browsers. That keeps the game hostable as
// static files (GitHub Pages) while still giving low-latency online play.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 when read aloud
const PREFIX = 'slp-';
export const CODE_LENGTH = 5;
export const MAX_PLAYERS = 4;

export function makeCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export function cleanCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

export function isValidCode(raw) {
  const code = cleanCode(raw);
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!ALPHABET.includes(ch)) return false;
  return true;
}

export class SquadNet {
  constructor() {
    this.peer = null;
    this.role = null; // 'host' | 'guest'
    this.code = '';
    this.selfId = '';
    this.conns = new Map(); // host: peerId -> DataConnection
    this.conn = null; // guest: link to the host
    this.onData = null; // (fromId, msg) => void
    this.onJoin = null; // (peerId) => void
    this.onLeave = null; // (peerId) => void
    this.onStatus = null; // (text, state) => void
  }

  status(text, state = '') {
    if (this.onStatus) this.onStatus(text, state);
  }

  waitOpen(peer, timeout = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(Object.assign(new Error('broker timeout'), { type: 'timeout' }));
      }, timeout);
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ------------------------------------------------------------------- host
  async host() {
    this.close();
    this.role = 'host';
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const code = makeCode();
      this.status('OPENING LINK…', 'busy');
      const peer = new Peer(PREFIX + code, { debug: 0 });
      try {
        await this.waitOpen(peer);
      } catch (err) {
        lastError = err;
        try {
          peer.destroy();
        } catch {
          /* already gone */
        }
        const type = String((err && err.type) || '');
        // an unavailable id just means someone else has that code: pick another
        if (type === 'unavailable-id' || type === 'invalid-id') continue;
        if (attempt >= 1) break;
        continue;
      }

      this.peer = peer;
      this.code = code;
      this.selfId = 'host';
      peer.on('connection', (conn) => this.accept(conn));
      peer.on('disconnected', () => {
        this.status('RECONNECTING LINK…', 'busy');
        try {
          peer.reconnect();
        } catch {
          /* the broker will be retried on the next socket open */
        }
      });
      peer.on('error', (err) => {
        if (String(err && err.type) === 'peer-unavailable') return;
        this.status('LINK ERROR · ' + String((err && err.type) || 'unknown'), 'err');
      });
      this.status('LIVE · CODE ' + code, 'ok');
      return { code, id: this.selfId };
    }

    this.status('COULD NOT OPEN A LINK', 'err');
    throw lastError || new Error('host failed');
  }

  accept(conn) {
    if (this.conns.size >= MAX_PLAYERS - 1) {
      conn.on('open', () => {
        try {
          conn.send({ t: 'full' });
        } catch {
          /* the peer vanished mid-handshake */
        }
        setTimeout(() => {
          try {
            conn.close();
          } catch {
            /* already closed */
          }
        }, 400);
      });
      return;
    }

    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      if (this.onJoin) this.onJoin(conn.peer);
    });
    conn.on('data', (data) => {
      if (this.onData) this.onData(conn.peer, data);
    });
    const drop = () => {
      if (this.conns.delete(conn.peer) && this.onLeave) this.onLeave(conn.peer);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  // ------------------------------------------------------------------ guest
  async join(rawCode) {
    this.close();
    this.role = 'guest';
    const code = cleanCode(rawCode);
    if (!isValidCode(code)) throw Object.assign(new Error('bad code'), { type: 'invalid-code' });

    this.status('DIALLING ' + code + '…', 'busy');
    const peer = new Peer({ debug: 0 });
    try {
      await this.waitOpen(peer);
    } catch (err) {
      try {
        peer.destroy();
      } catch {
        /* already gone */
      }
      this.status('NO LINK AVAILABLE', 'err');
      throw err;
    }
    this.peer = peer;
    this.code = code;
    this.selfId = peer.id;

    const conn = peer.connect(PREFIX + code, { reliable: false, serialization: 'json' });
    const opened = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(Object.assign(new Error('dial timeout'), { type: 'timeout' }));
      }, 16000);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      conn.on('open', () => finish(resolve));
      conn.on('error', (err) => finish(reject, err));
      peer.on('error', (err) => {
        if (String(err && err.type) === 'peer-unavailable') {
          finish(reject, Object.assign(new Error('no squad'), { type: 'peer-unavailable' }));
        } else {
          finish(reject, err);
        }
      });
    });

    try {
      await opened;
    } catch (err) {
      const type = String((err && err.type) || '');
      this.status(
        type === 'peer-unavailable' ? 'NO SQUAD ON ' + code : 'LINK FAILED', 'err'
      );
      try {
        peer.destroy();
      } catch {
        /* already gone */
      }
      this.peer = null;
      this.conn = null;
      throw err;
    }

    this.conn = conn;
    conn.on('data', (data) => {
      if (this.onData) this.onData('host', data);
    });
    conn.on('close', () => {
      if (this.onLeave) this.onLeave('host');
    });
    this.status('LIVE · CODE ' + code, 'ok');
    return { code, id: this.selfId };
  }

  // ---------------------------------------------------------------- traffic
  send(peerId, msg) {
    const conn = this.conns.get(peerId);
    if (!conn || !conn.open) return;
    try {
      conn.send(msg);
    } catch {
      /* a dropped packet is cheaper than a broken frame */
    }
  }

  broadcast(msg) {
    for (const conn of this.conns.values()) {
      if (!conn.open) continue;
      try {
        conn.send(msg);
      } catch {
        /* see above */
      }
    }
  }

  sendHost(msg) {
    if (!this.conn || !this.conn.open) return;
    try {
      this.conn.send(msg);
    } catch {
      /* see above */
    }
  }

  get peerCount() {
    return this.conns.size;
  }

  close() {
    for (const conn of this.conns.values()) {
      try {
        conn.close();
      } catch {
        /* already closed */
      }
    }
    this.conns.clear();
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        /* already closed */
      }
      this.conn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        /* already destroyed */
      }
      this.peer = null;
    }
    this.role = null;
    this.code = '';
  }
}
