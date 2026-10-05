import assert from "node:assert/strict";
const url = process.env.NONAME_TEST_LOBBY || "ws://127.0.0.1:8798";
class Peer {
	ws: WebSocket;
	messages: any[][] = [];
	raw: string[] = [];
	id = "";
	beat = 0;
	constructor(url: string, key: string) {
		this.ws = new WebSocket(url);
		this.ws.addEventListener("message", event => {
			if (event.data === "heartbeat") {
				this.beat++;
				this.ws.send("heartbeat");
				return;
			}
			this.raw.push(String(event.data));
			try {
				const m = JSON.parse(String(event.data));
				this.messages.push(m);
				if (m[0] === "roomlist") {
					this.id = m[4];
					this.send("key", [key]);
				}
			} catch {}
		});
	}
	send(type: string, ...args: unknown[]) {
		this.ws.send(JSON.stringify(["server", type, ...args]));
	}
	async wait(type: string, timeout = 10000): Promise<any[]> {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			const index = this.messages.findIndex(m => m[0] === type);
			if (index >= 0) return this.messages.splice(index, 1)[0];
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		throw new Error(`Timeout waiting for ${type}`);
	}
}
const key = "pwa-live-" + Date.now(),
	host = new Peer(url, key),
	guest = new Peer(url, key + "-guest"),
	other = new Peer(url, key + "-other");
try {
	await Promise.all([host.wait("roomlist"), guest.wait("roomlist"), other.wait("roomlist")]);
	host.send("create", key, "PWA房主", "caocao");
	await host.wait("createroom");
	host.send("config", { gameStarted: false, number: 2, observe: true });
	guest.send("enter", key, "桌面协议玩家", "liubei");
	assert.equal((await host.wait("onconnection"))[1], guest.id);
	const payload = JSON.stringify(["game", { fixture: "x".repeat(512 * 1024) }]);
	const start = performance.now();
	guest.ws.send(payload);
	assert.equal((await host.wait("onmessage"))[2], payload);
	const relayMs = performance.now() - start;
	host.send("send", guest.id, JSON.stringify(["init", 42]));
	assert.equal((await guest.wait("init"))[1], 42);
	other.send("send", guest.id, JSON.stringify(["injected"]));
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.ok(!guest.messages.some(m => m[0] === "injected"));
	console.log(JSON.stringify({ handshake: true, legacyRooms: true, bidirectionalRelay: true, ownershipIsolation: true, messageBytes: payload.length, relayMs }));
	if (process.env.NONAME_TEST_HEARTBEAT === "1") {
		await new Promise(resolve => setTimeout(resolve, 65000));
		assert.ok(host.beat >= 1 && guest.beat >= 1);
		guest.ws.send('["after-idle"]');
		assert.equal((await host.wait("onmessage"))[2], '["after-idle"]');
		console.log("Alarm heartbeat and idle-session relay passed");
	}
	host.ws.close();
	await guest.wait("selfclose");
	console.log("Owner disconnect cleanup passed");
} finally {
	host.ws.close();
	guest.ws.close();
	other.ws.close();
}
