import { LobbyCore, type Session, type LobbySnapshot, type Transport } from "../../server/src/server/lobby";
interface Env {
	NONAME_LOBBY: DurableObjectNamespace;
}
interface SocketTransport extends Transport {
	socket: WebSocket;
}
export class NonameLobby implements DurableObject {
	private core: LobbyCore;
	private topologyDirty = false;
	private scheduledAlarm: number | null | undefined;
	constructor(
		private ctx: DurableObjectState,
		_env: Env
	) {
		this.core = new LobbyCore({
			sessionChanged: (state: Session) => {
				const transport = this.core.clients.get(state.wsid)?.transport as SocketTransport | undefined;
				transport?.socket.serializeAttachment(state);
			},
			topologyChanged: () => {
				this.topologyDirty = true;
			},
		});
		ctx.blockConcurrencyWhile(async () => {
			const snapshot = await ctx.storage.get<LobbySnapshot>("topology");
			const sessions = ctx
				.getWebSockets()
				.map(socket => ({ state: socket.deserializeAttachment() as Session, transport: this.transport(socket) }))
				.filter(c => c.state?.wsid);
			this.core.restore(snapshot, sessions);
			// Persist removal of stale rooms once; not for every relayed game message.
			this.topologyDirty = true;
			await this.flush();
		});
	}
	private transport(socket: WebSocket): SocketTransport {
		return { socket, send: raw => socket.send(raw), close: () => socket.close(1000, "Lobby session closed") };
	}
	private async flush() {
		if (this.topologyDirty) {
			await this.ctx.storage.put("topology", this.core.snapshot());
			this.topologyDirty = false;
		}
		const next = this.core.nextAlarm();
		if (next === null) {
			if (this.scheduledAlarm !== null) await this.ctx.storage.deleteAlarm();
			this.scheduledAlarm = null;
		} else {
			if (this.scheduledAlarm !== next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
			this.scheduledAlarm = next;
		}
	}
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		this.core.connect(this.transport(server), request.headers.get("CF-Connecting-IP") || "unknown");
		await this.flush();
		return new Response(null, { status: 101, webSocket: client });
	}
	async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
		const session = socket.deserializeAttachment() as Session | null;
		if (!session) {
			socket.close(1008, "Missing session");
			return;
		}
		this.core.message(session.wsid, typeof message === "string" ? message : new TextDecoder().decode(message));
		await this.flush();
	}
	async webSocketClose(socket: WebSocket) {
		const session = socket.deserializeAttachment() as Session | null;
		if (session) this.core.disconnect(session.wsid);
		await this.flush();
	}
	async webSocketError(socket: WebSocket) {
		const session = socket.deserializeAttachment() as Session | null;
		if (session) this.core.close(session.wsid);
		await this.flush();
	}
	async alarm() {
		this.scheduledAlarm = undefined;
		this.core.tick();
		await this.flush();
	}
}
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path === "/health" && request.method === "GET") return Response.json({ status: "ok", protocol: "noname-legacy-v1", lobby: "friends-v1" });
		if (path !== "/" || request.method !== "GET") return new Response("Not found", { status: 404 });
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Use wss:// with the game lobby client", { status: 426 });
		const id = env.NONAME_LOBBY.idFromName("friends-v1");
		return env.NONAME_LOBBY.get(id, { locationHint: "apac" }).fetch(request);
	},
} satisfies ExportedHandler<Env>;
