import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceBridge } from './bridge.js';

const hello = '@HELLO,2,123456abcdef,abcd1234';
const state = (rev, entry = '', phase = 'playing', boot = 'abcd1234') =>
  `@STATE,${boot},1,${rev},${phase},1,200,${entry},0,0,0,24,-----:.----:..---:...--,7:10,,`;

function fixture() {
  let now = 0;
  const bridge = new DeviceBridge({ now: () => now });
  const connect = kind => {
    const lines = [];
    const link = bridge.attach(kind, line => lines.push(line));
    return { ...link, lines };
  };
  const wifi = connect('wifi');
  const usb = connect('usb');
  wifi.line(hello);
  usb.line(hello);
  const take = (link, snapshot) => {
    const lease = link.lines.findLast(line => line.startsWith('TAKE,')).split(',')[1];
    link.line(`@TAKEN,${lease}`);
    link.line(snapshot);
    return lease;
  };
  return { bridge, wifi, usb, take, advance(ms) { now += ms; bridge.tick(); } };
}

test('Wi-Fi commands are ordered and USB recovery never replays an uncertain key', async () => {
  const { bridge, wifi, usb, take } = fixture();
  const lease = take(wifi, state(1));
  const first = bridge.command('KEY,0');
  const second = bridge.command('KEY,1');
  const third = bridge.command('KEY,2');
  let frames = wifi.lines.filter(line => line.startsWith('CMD,'));
  assert.equal(frames.length, 1);
  const firstId = frames[0].split(',')[2];
  wifi.line(`@ACK,${lease},${firstId},OK`);
  assert.equal((await first).ok, true);
  frames = wifi.lines.filter(line => line.startsWith('CMD,'));
  assert.match(frames[1], /,KEY,1$/);
  const secondId = frames[1].split(',')[2];
  wifi.close();
  assert.equal(bridge.view().status, 'switching');
  assert.equal((await third).code, 'dropped');
  take(usb, state(2, '01').replace(',200,', ',197,') + secondId);
  assert.equal((await second).ok, true);
  assert.equal(bridge.view().transport, 'usb');
  assert.equal(bridge.view().state.entry, '01');
  assert.equal(bridge.view().state.seconds, 197);
  assert.equal(usb.lines.some(line => line.startsWith('CMD,')), false);
  assert.equal((await bridge.command('KEY,3', lease)).code, 'dropped');
});

test('three missed heartbeats switch to USB and recovering Wi-Fi waits for the run to finish', () => {
  const { bridge, wifi, usb, take, advance } = fixture();
  take(wifi, state(1));
  advance(1000);
  usb.line(hello);
  advance(1000);
  usb.line(hello);
  assert.equal(bridge.view().transport, 'wifi');
  advance(1000);
  take(usb, state(2, '2'));
  wifi.line(hello);
  assert.equal(bridge.view().transport, 'usb');
  usb.line(state(3, '', 'won'));
  assert.equal(bridge.view().status, 'switching');
  take(wifi, state(3, '', 'won'));
  assert.equal(bridge.view().transport, 'wifi');
});

test('offline runs resume with physical progress and a different boot is reported', () => {
  const { bridge, wifi, usb, take } = fixture();
  take(wifi, state(1));
  usb.close();
  wifi.close();
  assert.equal(bridge.view().status, 'offline');
  assert.equal(bridge.view().state.phase, 'playing');

  const lines = [];
  const cable = { ...bridge.attach('usb', line => lines.push(line)), lines };
  cable.line('@HELLO,1');
  assert.match(bridge.view().notice, /Update the ESP32 firmware/);
  cable.line(hello);
  take(cable, state(2, '23'));
  assert.equal(bridge.view().state.entry, '23');

  cable.line(hello.replace('abcd1234', '1234abcd'));
  take(cable, state(1, '', 'playing', '1234abcd'));
  assert.match(bridge.view().notice, /restarted/);
});

test('USB takes over even when the last Wi-Fi command never reached the board', async () => {
  const { bridge, wifi, usb, take } = fixture();
  const lease = take(wifi, state(1, '4'));
  const input = bridge.command('KEY,5');
  const id = wifi.lines.at(-1).split(',')[2];
  wifi.close();
  wifi.line(`@ACK,${lease},${id},OK`);
  take(usb, state(2, '4'));
  assert.equal((await input).code, 'uncertain');
  assert.equal(bridge.view().state.entry, '4');
  assert.equal(usb.lines.some(line => line.startsWith('CMD,')), false);
});

test('the music clock follows the matching playing snapshot on the active transport', () => {
  const { bridge, wifi, usb, take } = fixture();
  wifi.line('@MUSIC,abcd1234,1,1,40125');
  take(wifi, state(1));
  assert.equal(bridge.view().musicClock.elapsed, 40125);
  usb.line('@MUSIC,abcd1234,1,2,40250');
  assert.equal(bridge.view().musicClock.elapsed, 40125);
  wifi.close();
  assert.equal(bridge.view().musicClock, null);
  take(usb, state(2));
  assert.equal(bridge.view().musicClock.elapsed, 40250);
  usb.line('@MUSIC,abcd1234,1,3,41000');
  usb.line(state(3));
  assert.equal(bridge.view().musicClock, null);
  usb.line('@MUSIC,abcd1234,1,4,40000');
  usb.line(state(4, '', 'ready'));
  assert.equal(bridge.view().musicClock, null);
});
