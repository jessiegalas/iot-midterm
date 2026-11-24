import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const ROLES = ['defuser', 'expert'];
const INVITE_LIFETIME = 30 * 60 * 1000;
const STARTED_LIFETIME = 10 * 60 * 1000;
const TERMINAL_LIFETIME = 2 * 60 * 1000;
const token = () => randomBytes(18).toString('hex');
const open = lobby => ['waiting', 'ready'].includes(lobby?.status);
const ended = lobby => ['expired', 'closed'].includes(lobby?.status);

export function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 24 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

export class PlayerLobbies extends EventEmitter {
  #lobbies = new Map();
  #invites = new Map();
  #now;

  constructor({ now = Date.now } = {}) {
    super();
    this.#now = now;
  }

  sweep() {
    for (const id of this.#lobbies.keys()) this.#get(id);
  }

  create() {
    this.sweep();
    if ([...this.#lobbies.values()].filter(lobby => open(lobby) || lobby.status === 'starting').length >= 12 ||
        this.#lobbies.size >= 128) return null;
    const id = token();
    const invites = Object.fromEntries(ROLES.map(role => [role, token()]));
    const lobby = { id, invites, players: { defuser: null, expert: null }, receipts: {}, revision: 0,
      status: 'waiting', expires: this.#now() + INVITE_LIFETIME };
    this.#lobbies.set(id, lobby);
    for (const role of ROLES) this.#invites.set(invites[role], { id, role });
    return this.view(id);
  }

  #get(id) {
    const lobby = this.#lobbies.get(id);
    if (!lobby || lobby.expires > this.#now()) return lobby;
    if (ended(lobby)) {
      this.#lobbies.delete(lobby.id);
      for (const invite of Object.values(lobby.invites)) this.#invites.delete(invite);
      return undefined;
    }
    this.#end(lobby, 'expired');
    return lobby;
  }

  #end(lobby, status) {
    lobby.status = status;
    lobby.expires = this.#now() + TERMINAL_LIFETIME;
    lobby.players = { defuser: null, expert: null };
    lobby.receipts = {};
    lobby.result = null;
    this.emit(lobby.id, null);
    this.removeAllListeners(lobby.id);
  }

  #update(lobby) {
    lobby.revision++;
    const view = this.view(lobby.id);
    this.emit(lobby.id, view);
    return view;
  }

  #refreshReadiness(lobby) {
    lobby.status = ROLES.every(role => lobby.players[role]) ? 'ready' : 'waiting';
    return this.#update(lobby);
  }

  view(id) {
    const lobby = this.#get(id);
    if (!lobby || ended(lobby)) return null;
    return { id, revision: lobby.revision, players: { ...lobby.players }, status: lobby.status };
  }

  status(id) {
    return this.#get(id)?.status ?? 'closed';
  }

  invite(id, role) {
    const lobby = this.#get(id);
    return ROLES.includes(role) && open(lobby) ? lobby.invites[role] : null;
  }

  describe(invite, receipt) {
    const info = this.#invites.get(invite);
    const lobby = info && this.#get(info.id);
    if (!lobby || ended(lobby)) return null;
    const { role } = info;
    const confirmed = Boolean(receipt && lobby.receipts[role] === receipt);
    return { role, occupied: Boolean(lobby.players[role]), status: lobby.status,
      ...(confirmed ? { name: lobby.players[role] } : {}) };
  }

  join(invite, value, receipt) {
    const info = this.#invites.get(invite);
    const lobby = info && this.#get(info.id);
    if (!lobby || ended(lobby)) return { code: 'closed' };
    const name = cleanName(value);
    if (!name) return { code: 'invalid' };
    const { role } = info;
    if (lobby.receipts[role] && receipt === lobby.receipts[role] && name === lobby.players[role]) {
      return { role, receipt, name, status: lobby.status };
    }
    if (!open(lobby) || lobby.players[role]) return { code: 'occupied' };
    lobby.players[role] = name;
    lobby.receipts[role] = receipt || token();
    this.#refreshReadiness(lobby);
    return { role, receipt: lobby.receipts[role], name, status: lobby.status };
  }

  assign(id, values) {
    const lobby = this.#get(id);
    if (!lobby || ended(lobby)) return { code: 'closed' };
    if (!open(lobby)) return { code: 'busy' };
    const roles = Object.keys(values);
    if (!roles.length || roles.some(role => !ROLES.includes(role))) return { code: 'invalid' };
    const names = {};
    for (const role of roles) {
      const name = cleanName(values[role]);
      if (!name) return { code: 'invalid' };
      if (lobby.players[role] && lobby.players[role] !== name) return { code: 'occupied' };
      if (!lobby.players[role]) names[role] = name;
    }
    if (!Object.keys(names).length) return this.view(id);
    Object.assign(lobby.players, names);
    return this.#refreshReadiness(lobby);
  }

  async start(id, mode, launch) {
    const lobby = this.#get(id);
    if (!lobby || ended(lobby)) return { code: 'closed' };
    if (['starting', 'started'].includes(lobby.status) && mode !== lobby.mode) return { code: 'busy' };
    if (lobby.status === 'started') return lobby.result;
    if (lobby.status === 'starting') return lobby.start ?? { code: 'uncertain' };
    if (lobby.status !== 'ready') return { code: 'incomplete' };
    lobby.status = 'starting';
    lobby.mode = mode;
    const players = { ...lobby.players };
    lobby.start = Promise.resolve().then(() => mode === 'simulation' ? { ok: true, runId: randomUUID() } : launch(players))
      .catch(() => ({ code: 'unavailable' }))
      .then(outcome => {
        lobby.start = null;
        if (lobby.status === 'started') return lobby.result;
        if (outcome.ok) return this.confirm(id, outcome.runId) ?? { code: 'closed' };
        if (outcome.code !== 'uncertain') this.release(id);
        return outcome;
      });
    this.#update(lobby);
    return lobby.start;
  }

  confirm(id, runId) {
    const lobby = this.#get(id);
    if (lobby?.status === 'started') return lobby.result;
    if (lobby?.status !== 'starting') return null;
    lobby.status = 'started';
    lobby.expires = this.#now() + STARTED_LIFETIME;
    lobby.result = { ok: true, status: 'started', runId, players: { ...lobby.players } };
    this.#update(lobby);
    return lobby.result;
  }

  release(id) {
    const lobby = this.#get(id);
    if (lobby?.status === 'starting') {
      lobby.status = 'ready';
      this.#update(lobby);
    }
  }

  close(id) {
    const lobby = this.#get(id);
    if (lobby && lobby.status !== 'started' && !ended(lobby)) this.#end(lobby, 'closed');
  }
}
