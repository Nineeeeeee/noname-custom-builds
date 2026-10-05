import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerInstance, ServerOptions } from "../types";
import { LobbyCore } from "./lobby";

/** Node adapter. The same room and relay rules run in the Cloudflare lobby. */
export function createServer(options: ServerOptions = {}): ServerInstance {
	let wss: WebSocketServer | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	const core = new LobbyCore({ sessionChanged() {}, topologyChanged() {} });
	const connection = (ws: WebSocket, req: IncomingMessage) => {
		const session = core.connect({ send: raw => ws.send(raw), close: () => ws.close() }, req.socket.remoteAddress || "");
		if (!session) return;
		ws.on("message", data => core.message(session.wsid, data.toString()));
		ws.on("close", () => core.disconnect(session.wsid));
		ws.on("error", () => core.close(session.wsid));
	};
	return {
		start() {
			if (wss) return Promise.resolve();
			return new Promise<void>((resolve, reject) => {
				const server = new WebSocketServer({ port: options.port ?? 8082, maxPayload: 8 * 1024 * 1024 });
				wss = server;
				const onError = (error: Error) => {
					server.off("listening", onListening);
					wss = undefined;
					reject(error);
				};
				const onListening = () => {
					server.off("error", onError);
					server.on("error", error => console.error("Lobby server error", error));
					timer = setInterval(() => core.tick(), 1000);
					resolve();
				};
				server.once("error", onError);
				server.once("listening", onListening);
				server.on("connection", connection);
			});
		},
		stop() {
			if (!wss) return Promise.resolve();
			const server = wss;
			wss = undefined;
			clearInterval(timer);
			for (const id of [...core.clients.keys()]) core.close(id);
			return new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
		},
	};
}
