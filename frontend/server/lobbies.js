import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const ROLES = ['defuser', 'expert'];
const INVITE_LIFETIME = 30 * 60 * 1000;
const token = () => randomBytes(18).toString('hex');

function cleanName(value) {
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

  create() {
    for (const id of this.#lobbies.keys()) this.#get(id);
    if (this.#lobbies.size >= 12) return null;
    const id = token();
    const invites = Object.fromEntries(ROLES.map(role => [role, token()]));
    const players = { defuser: null, expert: null };
    const lobby = { id, invites, players, revision: 0, expires: this.#now() + INVITE_LIFETIME };
    this.#lobbies.set(id, lobby);
    for (const role of ROLES) this.#invites.set(invites[role], { id, role });
    return this.view(id);
  }

  #get(id) {
    const lobby = this.#lobbies.get(id);
    if (lobby && lobby.expires <= this.#now()) {
      this.close(id);
      return null;
    }
    return lobby;
  }

  view(id) {
    const lobby = this.#get(id);
    return lobby ? { id, revision: lobby.revision, players: { ...lobby.players } } : null;
  }

  invite(id, role) {
    return ROLES.includes(role) ? this.#get(id)?.invites[role] : null;
  }

  describe(invite) {
    const info = this.#invites.get(invite);
    const lobby = info && this.#get(info.id);
    return lobby ? { role: info.role, occupied: Boolean(lobby.players[info.role]) } : null;
  }

  join(invite, value) {
    const info = this.#invites.get(invite);
    const lobby = info && this.#get(info.id);
    if (!lobby) return { code: 'closed' };
    const name = cleanName(value);
    if (!name) return { code: 'invalid' };
    const assigned = lobby.players[info.role];
    if (assigned && assigned !== name) return { code: 'occupied' };
    if (!assigned) {
      lobby.players[info.role] = name;
      lobby.revision++;
      this.emit(lobby.id, this.view(lobby.id));
    }
    return { role: info.role };
  }

  assign(id, values) {
    const lobby = this.#get(id);
    if (!lobby) return { code: 'closed' };
    const names = {};
    for (const role of ROLES) {
      if (!Object.hasOwn(values, role)) continue;
      const name = cleanName(values[role]);
      if (!name) return { code: 'invalid' };
      names[role] = name;
    }
    if (Object.keys(names).length === 0) return { code: 'invalid' };
    Object.assign(lobby.players, names);
    lobby.revision++;
    const result = this.view(id);
    this.emit(id, result);
    return result;
  }

  close(id) {
    const lobby = this.#lobbies.get(id);
    if (!lobby) return;
    this.#lobbies.delete(id);
    for (const invite of Object.values(lobby.invites)) this.#invites.delete(invite);
    this.emit(id, null);
  }
}
