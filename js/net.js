// Сеть: PeerJS (WebRTC). Интернет нужен только для «рукопожатия» при подключении,
// дальше данные идут напрямую между телефонами по локальной сети.
const PREFIX = 'tankhaos-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const Peer = window.Peer;

// Свой сервер рукопожатий можно указать в адресе: ?peer=host:port/path (по умолчанию — публичный PeerJS).
function peerOptions() {
  const opts = { debug: 1 };
  const custom = new URLSearchParams(location.search).get('peer');
  if (custom) {
    const m = custom.match(/^([^:/]+)(?::(\d+))?(\/.*)?$/);
    if (m) {
      opts.host = m[1];
      opts.port = +(m[2] || 443);
      opts.path = m[3] || '/';
      opts.secure = opts.port === 443;
    }
  }
  return opts;
}

export function randomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function describeError(err) {
  switch (err?.type) {
    case 'peer-unavailable': return 'Комната не найдена. Проверьте код.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Нет связи с сервером подключения. Нужен интернет на пару секунд.';
    case 'browser-incompatible': return 'Браузер не поддерживает WebRTC.';
    default: return 'Ошибка сети: ' + (err?.type || err?.message || err);
  }
}

// Хост: создаёт комнату и принимает игроков.
export function hostRoom({ onJoin, onMessage, onLeave, onError }) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryOpen = () => {
      const code = randomCode();
      const peer = new Peer(PREFIX + code, peerOptions());
      const conns = new Map();
      let opened = false;

      peer.on('open', () => {
        opened = true;
        resolve({
          code,
          send(connId, msg) {
            const c = conns.get(connId);
            if (c?.open) c.send(msg);
          },
          broadcast(msg) {
            for (const c of conns.values()) if (c.open) c.send(msg);
          },
          kick(connId) {
            conns.get(connId)?.close();
          },
          close() {
            for (const c of conns.values()) c.close();
            peer.destroy();
          },
        });
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          conns.set(conn.peer, conn);
          onJoin(conn.peer, conn.metadata || {});
        });
        conn.on('data', (msg) => onMessage(conn.peer, msg));
        const gone = () => {
          if (!conns.has(conn.peer)) return;
          conns.delete(conn.peer);
          onLeave(conn.peer);
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });

      // Связь с сервером рукопожатий пропала — уже подключённые играют дальше,
      // а для новых игроков пробуем переподключиться.
      peer.on('disconnected', () => {
        setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000);
      });

      peer.on('error', (err) => {
        if (!opened && err.type === 'unavailable-id' && attempts++ < 5) {
          peer.destroy();
          tryOpen();
        } else if (!opened) {
          peer.destroy();
          reject(new Error(describeError(err)));
        } else if (err.type !== 'peer-unavailable') {
          onError?.(describeError(err));
        }
      });
    };
    tryOpen();
  });
}

// Игрок: подключается к комнате по коду.
export function joinRoom(code, name, { onMessage, onClose }) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let done = false;
    const fail = (msg) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('Не удалось подключиться к хосту (таймаут).'), 15000);

    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), {
        serialization: 'json',
        reliable: true,
        metadata: { name },
      });
      conn.on('open', () => {
        clearTimeout(timer);
        done = true;
        resolve({
          send(msg) { if (conn.open) conn.send(msg); },
          close() { conn.close(); peer.destroy(); },
        });
      });
      conn.on('data', onMessage);
      conn.on('close', () => { if (done) onClose(); });
      conn.on('error', () => { if (done) onClose(); else fail('Соединение не установилось.'); });
    });

    peer.on('error', (err) => {
      clearTimeout(timer);
      if (!done) fail(describeError(err));
    });
  });
}
