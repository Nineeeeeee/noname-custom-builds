import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyCore, type Session, type Transport } from "../../packages/server/src/server/lobby.ts";
function fixture() {
	let now = 100000;
	const attachments = new Map<string, Session>();
	let dirty = 0;
	const core = new LobbyCore({ sessionChanged: s => attachments.set(s.wsid, structuredClone(s)), topologyChanged: () => dirty++ }, () => now);
	const connect = (key: string) => {
		const messages: string[] = [];
		let closed = false;
		const transport: Transport = {
			send: s => messages.push(s),
			close: () => {
				closed = true;
			},
		};
		const s = core.connect(transport, "127.0.0.1")!;
		const send = (type: string, ...args: unknown[]) => core.message(s.wsid, JSON.stringify(["server", type, ...args]));
		send("key", [key]);
		return { s, messages, send, transport, closed: () => closed };
	};
	return {
		core,
		connect,
		attachments,
		advance: (ms: number) => {
			now += ms;
			core.tick();
		},
		dirty: () => dirty,
	};
}
test("legacy room creation, failed entry has no phantom member; relay ownership isolation", () => {
	const { core, connect } = fixture();
	const host = connect("host"),
		guest = connect("guest"),
		stranger = connect("stranger");
	host.send("create", "host", "房主", "caocao");
	guest.send("enter", "host", "玩家", "liubei");
	assert.equal(guest.s.roomKey, undefined);
	host.send("config", { number: 2, gameStarted: false });
	guest.send("enter", "host", "玩家", "liubei");
	assert.equal(guest.s.ownerWsId, host.s.wsid);
	assert.equal(core.roomList()[0][3], 2);
	core.message(guest.s.wsid, '["game",42]');
	assert.ok(host.messages.includes(JSON.stringify(["onmessage", guest.s.wsid, '["game",42]'])));
	stranger.send("send", guest.s.wsid, "injected");
	assert.ok(!guest.messages.includes("injected"));
	host.send("send", guest.s.wsid, "valid");
	assert.ok(guest.messages.includes("valid"));
	stranger.send("close", guest.s.wsid);
	assert.ok(core.clients.has(guest.s.wsid));
	core.disconnect(host.s.wsid);
	assert.equal(core.rooms.size, 0);
	assert.equal(guest.s.roomKey, undefined);
	assert.ok(guest.messages.includes('["selfclose"]'));
	core.disconnect(host.s.wsid);
	assert.equal(guest.messages.filter(m => m === '["selfclose"]').length, 1);
});
test("hibernation restores attachments, config, events, guest routing and heartbeat deadlines", () => {
	const f = fixture();
	const host = f.connect("host"),
		guest = f.connect("guest");
	host.send("create", "host", "a", "b");
	host.send("config", { gameStarted: false, huge: "x".repeat(20000) });
	guest.send("enter", "host");
	host.send("events", { utc: 999999, day: 1, hour: 1, content: "约战" }, "host");
	const fresh = new LobbyCore({ sessionChanged() {}, topologyChanged() {} }, () => 100000);
	fresh.restore(
		structuredClone(f.core.snapshot()),
		[...f.core.clients].map(([id, c]) => ({ state: f.attachments.get(id)!, transport: c.transport }))
	);
	fresh.message(guest.s.wsid, "after sleep");
	assert.ok(host.messages.some(m => m.includes("after sleep")));
	assert.equal(fresh.events.length, 1);
	assert.equal(fresh.rooms.size, 1);
	assert.equal(fresh.roomList()[0][3], 2);
	assert.ok(JSON.stringify(f.attachments.get(host.s.wsid)).length < 16384);
	f.advance(60001);
	assert.ok(host.messages.includes("heartbeat"));
	f.core.message(host.s.wsid, "heartbeat");
	f.advance(60000);
	assert.ok(f.core.clients.has(host.s.wsid));
	assert.ok(!f.core.clients.has(guest.s.wsid));
	assert.ok(host.messages.some(m => m.includes("onclose")));
});
test("started-room observation, duplicate keys, missing handshake and expired events", () => {
	const f = fixture();
	const host = f.connect("host"),
		guest = f.connect("guest");
	host.send("create", "host");
	host.send("config", { gameStarted: true, observe: false });
	guest.send("enter", "host");
	assert.equal(guest.s.roomKey, undefined);
	host.send("config", { gameStarted: true, observe: true, observeReady: true });
	guest.send("enter", "host");
	assert.equal(guest.s.roomKey, "host");
	const other = f.connect("host");
	other.send("create", "host");
	assert.equal(f.core.rooms.get("host")!.ownerWsId, host.s.wsid);
	let closed = false;
	f.core.connect(
		{
			send() {},
			close: () => {
				closed = true;
			},
		},
		"127.0.0.2"
	);
	f.advance(2001);
	assert.ok(closed);
});
