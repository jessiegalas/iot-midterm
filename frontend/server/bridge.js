import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { isCommand, parseFrame, VERSION } from './protocol.js';

const token = () => randomBytes(8).toString('hex');
const result = (code, ok = false) => ({ ok, code });
const live = state => ['ready', 'playing', 'cleared'].includes(state?.phase);
const confirmsStart = (command, frame) => command?.start && command.start.boot === frame.boot &&
  command.start.run === frame.run && frame.phase !== 'idle' && frame.lastCommand === command.id;
const confirmsReset = (command, frame) => command?.reset && command.reset.boot === frame.boot &&
  command.reset.run === frame.run && frame.phase === 'idle' && frame.lastCommand === command.id;
const startResult = (frame, device) => ({ ...result('applied', true), runId: `esp32:${device}:${frame.boot}:${frame.run}` });
const LINK_TIMEOUT = 3000;
const HANDOFF_TIMEOUT = 1000;
const COMMAND_TIMEOUT = 1200;

export class DeviceBridge extends EventEmitter {
  links = new Map();
  active = null;
  taking = null;
  state = null;
  musicClock = null;
  device = null;
  queue = [];
  pending = null;
  uncertain = null;
  notice = '';
  published = null;
  nextHeartbeat = 0;

  constructor({ now = () => performance.now(), recorder, requireStorage = false } = {}) {
    super();
    this.now = now;
    this.recorder = recorder;
    this.requireStorage = requireStorage;
    if (recorder?.view.runStatus === 'active' || recorder?.view.runStatus === 'reconnecting') recorder.connectionLost(this.now());
  }

  healthy(link) {
    return link?.seen != null && this.now() - link.seen < LINK_TIMEOUT &&
      (!this.device || this.device === link.device);
  }

  view() {
    const oldFirmware = [...this.links.values()].some(link => link.version && link.version !== VERSION);
    const wrongDevice = [...this.links.values()].some(link => link.device && this.device && link.device !== this.device);
    return {
      status: this.active ? 'connected' : this.taking ? 'switching' : 'offline',
      transport: this.active?.kind ?? null,
      connection: this.active?.lease ?? null,
      usbReady: this.healthy(this.links.get('usb')),
      state: this.recorder?.view.snapshot ?? this.state,
      musicClock: this.active ? this.musicClock : null,
      runStatus: this.recorder?.view.runStatus ?? null,
      scoreStatus: this.recorder?.view.scoreStatus ?? (['won', 'lost'].includes(this.state?.phase) && !this.recorder ? 'failed' : null),
      notice: this.notice || (oldFirmware ? 'Update the ESP32 firmware to protocol ' + VERSION + '.' :
        wrongDevice ? 'The standby link belongs to a different ESP32.' :
          this.recorder?.view.runStatus === 'unconfirmed' ? 'The hardware result is unconfirmed. Reconnect to check the board.' :
            this.recorder?.failed ? 'Hardware state could not be saved yet. The bridge will retry.' : ''),
    };
  }

  publish() {
    const view = this.view();
    if (this.published && Object.keys(view).every(key => view[key] === this.published[key])) return;
    this.published = view;
    this.emit('change', view);
  }

  transmit(link, line) {
    try {
      link.send(line);
    } catch {
      link.close();
    }
  }

  attach(kind, send) {
    this.links.get(kind)?.close();
    const link = { kind, send, seen: null, version: null, device: null, boot: null };
    const current = () => this.links.get(kind) === link;
    link.close = () => {
      if (!current()) return;
      this.links.delete(kind);
      if (this.active === link) this.loseControl();
      if (this.taking?.link === link) this.taking = null;
      this.select();
      this.publish();
    };
    this.links.set(kind, link);
    this.transmit(link, 'SYNC');
    return {
      line: line => { if (current()) this.receive(link, parseFrame(line)); },
      close: link.close,
    };
  }

  receive(link, frame) {
    if (!frame) return;
    if (frame.type === 'hello') {
      const changed = link.version !== frame.version || link.boot !== frame.boot || !this.healthy(link);
      if (link.boot && link.boot !== frame.boot && this.active === link) this.loseControl();
      if (this.taking?.link === link && link.boot && link.boot !== frame.boot) this.taking = null;
      link.version = frame.version;
      link.device = frame.device;
      link.boot = frame.boot;
      link.seen = frame.version === VERSION ? this.now() : null;
      this.select();
      if (changed) this.publish();
      return;
    }
    if (frame.type === 'taken') {
      if (this.taking?.link === link && this.taking.lease === frame.lease) this.taking.confirmed = true;
      return;
    }
    if (frame.type === 'music') {
      if (frame.boot === link.boot) link.music = { ...frame, sampledAt: Date.now() };
      return;
    }
    if (frame.type === 'ack') {
      if (this.active !== link || this.pending?.id !== frame.command || this.active.lease !== frame.lease) return;
      const command = this.pending;
      if ((command.start || command.reset) && frame.ok) return;
      if (command.start) this.recorder?.settle(command.id, 'abandoned');
      this.pending = null;
      command.resolve(frame.ok ? result('applied', true) : result('refused'));
      this.pump();
      return;
    }

    if (frame.type !== 'state' || frame.boot !== link.boot) return;
    const reconciled = this.taking?.link === link && this.taking.confirmed;
    if (reconciled) {
      link.lease = this.taking.lease;
      this.active = link;
      this.device = link.device;
      this.taking = null;
    }
    if (this.active !== link) return;
    const lastKnown = this.state ?? this.recorder?.view.snapshot;
    if (this.state?.boot !== frame.boot) {
      if (live(lastKnown) && (lastKnown.boot !== frame.boot || (lastKnown.deviceId && lastKnown.deviceId !== link.device))) {
        this.notice = 'The ESP32 restarted or changed. The previous result is unconfirmed.';
      }
    } else {
      if (frame.revision < this.state.revision) return;
      if (frame.run !== this.state.run) this.notice = '';
    }
    const previous = this.state;
    this.state = frame;
    const music = link.music;
    const secondsElapsed = 240 - frame.seconds;
    this.musicClock = frame.phase === 'playing' && music?.boot === frame.boot &&
      music.run === frame.run && music.revision === frame.revision &&
      Math.floor(music.elapsed / 1000) === secondsElapsed
      ? { elapsed: music.elapsed, sampledAt: music.sampledAt } : null;
    link.music = null;
    const saved = !this.recorder || this.recorder.observe(link.device, frame, reconciled);
    if (reconciled && this.uncertain) {
      const recovering = this.uncertain;
      const applied = recovering.start ? saved && confirmsStart(recovering, frame) :
        recovering.reset ? confirmsReset(recovering, frame) : previous?.boot === frame.boot && frame.lastCommand === recovering.id;
      if (!applied && recovering.start) this.recorder?.settle(recovering.id, 'unconfirmed');
      recovering.resolve(applied ? (recovering.start ? startResult(frame, link.device) : result('applied', true)) : result('uncertain'));
      this.uncertain = null;
    }
    if ((saved && confirmsStart(this.pending, frame)) || confirmsReset(this.pending, frame)) {
      const command = this.pending;
      this.pending = null;
      command.resolve(command.start ? startResult(frame, link.device) : result('applied', true));
      this.pump();
    }
    this.select();
    this.publish();
  }

  loseControl() {
    this.active = null;
    this.musicClock = null;
    this.recorder?.connectionLost(this.now());
    if (this.pending) {
      this.uncertain = { ...this.pending, deadline: this.now() + LINK_TIMEOUT + HANDOFF_TIMEOUT };
      this.pending = null;
    }
    for (const command of this.queue.splice(0)) command.resolve(result('dropped'));
  }

  select() {
    const wifi = this.links.get('wifi');
    const usb = this.links.get('usb');
    if (this.taking || this.pending || this.queue.length) return;
    if (this.active && (this.active.kind === 'wifi' || live(this.state) || !this.healthy(wifi))) return;
    const next = this.healthy(wifi) ? wifi : this.healthy(usb) ? usb : null;
    if (!next || next === this.active) return;
    if (this.active) this.loseControl();
    this.taking = { link: next, lease: token(), deadline: this.now() + HANDOFF_TIMEOUT, confirmed: false };
    this.publish();
    this.transmit(next, `TAKE,${this.taking.lease}`);
  }

  tick() {
    const now = this.now();
    if (this.active && (!this.healthy(this.active) || this.pending?.deadline <= now)) {
      this.active.seen = null;
      this.loseControl();
      this.publish();
    }
    if (this.taking?.deadline <= now) {
      this.taking.link.seen = null;
      this.taking = null;
      this.publish();
    }
    if (this.uncertain?.deadline <= now) {
      if (this.uncertain.start) this.recorder?.settle(this.uncertain.id, 'unconfirmed');
      this.uncertain.resolve(result('uncertain'));
      this.uncertain = null;
    }
    if (now >= this.nextHeartbeat) {
      this.nextHeartbeat = now + 1000;
      for (const link of this.links.values()) this.transmit(link, link.version === VERSION ? 'PING' : 'SYNC');
    }
    this.recorder?.tick(now);
    this.select();
    this.publish();
  }

  command(value, connection = this.active?.lease, options = {}) {
    if (!isCommand(value)) return Promise.resolve(result('invalid'));
    if (!this.active) return Promise.resolve(result('offline'));
    if (connection !== this.active.lease) return Promise.resolve(result('dropped'));
    if (this.queue.length >= 16) return Promise.resolve(result('busy'));
    return new Promise(resolve => {
      this.queue.push({ value, resolve, id: token(), options });
      this.pump();
    });
  }

  pump() {
    if (!this.active || this.pending) return;
    const command = this.queue.shift();
    if (!command) return;
    if (command.options.confirmStart) {
      if (!this.state || live(this.state) || this.uncertain?.start) {
        command.resolve(result('busy'));
        this.pump();
        return;
      }
      command.start = { boot: this.state.boot, run: (this.state.run + 1) >>> 0 };
      const failure = this.recorder ? this.recorder.stage(command.id, this.active.device, command.start, command.options) :
        this.requireStorage ? 'unavailable' : null;
      if (failure) {
        command.resolve(result(failure));
        this.pump();
        return;
      }
    }
    if (command.options.confirmReset && this.state) command.reset = { boot: this.state.boot, run: this.state.run };
    this.pending = { ...command, deadline: this.now() + COMMAND_TIMEOUT };
    this.transmit(this.active, `CMD,${this.active.lease},${command.id},${command.value}`);
  }
}
