/** Transport-independent legacy lobby protocol; shared by Node/ws and Workers DO. */
export interface Session {
	wsid: string;
	clientIp: string;
	nickname: string;
	avatar: string;
	onlineKey?: string;
	status?: string;
	ownerWsId?: string;
	roomKey?: string;
	servermode?: boolean;
	keyDeadline: number;
	heartbeatAt: number;
	awaitingHeartbeat?: boolean;
}
export interface Room {
	key: string;
	ownerWsId: string;
	config?: Record<string, any>;
	servermode?: boolean;
}
export interface EventItem {
	id: string;
	creator: string;
	nickname: string;
	avatar: string;
	utc: number;
	day: number;
	hour: number;
	content: string;
	members: string[];
}
export interface LobbySnapshot {
	rooms: Room[];
	events: EventItem[];
	bannedKeys: string[];
	bannedIps: string[];
	bannedWords: string[];
}
export interface Transport {
	send(raw: string): void;
	close(): void;
}
export interface Hooks {
	sessionChanged(session: Session): void;
	topologyChanged(): void;
}
export class LobbyCore {
	clients = new Map<string, { state: Session; transport: Transport }>();
	rooms = new Map<string, Room>();
	events: EventItem[] = [];
	bannedKeys = new Set<string>();
	bannedIps = new Set<string>();
	bannedWords: string[] = [];
	constructor(
		private hooks: Hooks,
		private now = () => Date.now()
	) {}
	id() {
		let id: string;
		do {
			id = Math.floor(1e9 + Math.random() * 9e9).toString();
		} while (this.clients.has(id) || this.events.some(e => e.id === id));
		return id;
	}
	send(id: string, ...args: any[]) {
		this.sendRaw(id, JSON.stringify(args));
	}
	sendRaw(id: string, raw: string) {
		const c = this.clients.get(id);
		if (c) {
			try {
				c.transport.send(raw);
			} catch {
				this.close(id);
			}
		}
	}
	close(id: string) {
		const client = this.clients.get(id);
		if (client) {
			this.disconnect(id);
			try {
				client.transport.close();
			} catch {}
		}
	}
	changed(s: Session) {
		this.hooks.sessionChanged(s);
	}
	snapshot(): LobbySnapshot {
		return { rooms: [...this.rooms.values()], events: this.events, bannedKeys: [...this.bannedKeys], bannedIps: [...this.bannedIps], bannedWords: this.bannedWords };
	}
	restore(snapshot: Partial<LobbySnapshot> | undefined, sessions: { state: Session; transport: Transport }[]) {
		for (const c of sessions) this.clients.set(c.state.wsid, c);
		this.bannedKeys = new Set(snapshot?.bannedKeys || []);
		this.bannedIps = new Set(snapshot?.bannedIps || []);
		this.bannedWords = snapshot?.bannedWords || [];
		this.events = snapshot?.events || [];
		this.pruneEvents();
		for (const room of snapshot?.rooms || []) if (this.clients.has(room.ownerWsId)) this.rooms.set(room.key, room);
		for (const { state } of this.clients.values())
			if (state.roomKey && !this.rooms.has(state.roomKey)) {
				delete state.roomKey;
				delete state.ownerWsId;
				this.changed(state);
				this.send(state.wsid, "selfclose");
			}
	}
	connect(transport: Transport, ip: string): Session | null {
		if (this.bannedIps.has(ip) || this.clients.size >= 64) {
			transport.send(JSON.stringify(["denied", "banned"]));
			transport.close();
			return null;
		}
		const s: Session = { wsid: this.id(), clientIp: ip, nickname: "无名玩家", avatar: "caocao", keyDeadline: this.now() + 2000, heartbeatAt: this.now() + 60000 };
		this.clients.set(s.wsid, { state: s, transport });
		this.changed(s);
		this.send(s.wsid, "roomlist", this.roomList(), this.pruneEvents(), this.clientList(), s.wsid);
		return s;
	}
	clientList() {
		return [...this.clients.values()].map(({ state: c }) => [c.nickname, c.avatar, !c.roomKey, c.status, c.wsid, c.onlineKey]);
	}
	roomList() {
		return [...this.rooms.values()].flatMap<any>(r => {
			const owner = this.clients.get(r.ownerWsId)?.state;
			return r.servermode ? ["server"] : owner && r.config ? [[owner.nickname, owner.avatar, r.config, [...this.clients.values()].filter(c => c.state.roomKey === r.key && !c.state.servermode).length, r.key]] : [];
		});
	}
	updateRooms() {
		const rooms = this.roomList(),
			clients = this.clientList();
		for (const { state: c } of this.clients.values()) if (!c.roomKey) this.send(c.wsid, "updaterooms", rooms, clients);
	}
	updateClients() {
		const clients = this.clientList();
		for (const { state: c } of this.clients.values()) if (!c.roomKey) this.send(c.wsid, "updateclients", clients);
	}
	pruneEvents() {
		this.events = this.events.filter(e => e.utc > this.now());
		return this.events;
	}
	updateEvents() {
		this.pruneEvents();
		for (const { state: c } of this.clients.values()) if (!c.roomKey) this.send(c.wsid, "updateevents", this.events);
		this.hooks.topologyChanged();
	}
	nickname(value: unknown) {
		return typeof value === "string" ? value.slice(0, 12) : "无名玩家";
	}
	avatar(value: unknown) {
		return typeof value === "string" ? value.slice(0, 256) : "caocao";
	}
	message(id: string, raw: string) {
		const s = this.clients.get(id)?.state;
		if (!s) return;
		if (raw.length > 8 * 1024 * 1024) {
			this.close(id);
			return;
		}
		if (raw === "heartbeat") {
			s.awaitingHeartbeat = false;
			this.changed(s);
			return;
		}
		if (s.ownerWsId) {
			this.send(s.ownerWsId, "onmessage", id, raw);
			return;
		}
		let arr: any[];
		try {
			arr = JSON.parse(raw);
			if (!Array.isArray(arr)) throw new Error();
		} catch {
			this.send(id, "denied", "banned");
			return;
		}
		if (arr[0] !== "server" || typeof arr[1] !== "string") return;
		const [, type, ...args] = arr;
		if (type === "key") {
			const key = args[0];
			if (!Array.isArray(key) || typeof key[0] !== "string" || !key[0] || key[0].length > 256 || this.bannedKeys.has(key[0])) {
				this.send(id, "denied", "key");
				this.close(id);
				return;
			}
			s.onlineKey = key[0];
			s.keyDeadline = 0;
			this.changed(s);
			return;
		}
		if (!s.onlineKey) {
			this.send(id, "denied", "key");
			return;
		}
		switch (type) {
			case "create": {
				const [key, nickname, avatar] = args;
				if (s.onlineKey !== key || s.roomKey || this.rooms.has(key)) return;
				s.nickname = this.nickname(nickname);
				s.avatar = this.avatar(avatar);
				s.roomKey = key;
				delete s.status;
				this.rooms.set(key, { key, ownerWsId: id });
				this.changed(s);
				this.hooks.topologyChanged();
				this.send(id, "createroom", key);
				this.updateRooms();
				break;
			}
			case "enter": {
				const [key, nickname, avatar] = args;
				const room = this.rooms.get(key);
				if (s.roomKey || !room || !this.clients.has(room.ownerWsId) || !room.config || (room.config.gameStarted && (!room.config.observe || !room.config.observeReady))) {
					this.send(id, "enterroomfailed");
					break;
				}
				s.nickname = this.nickname(nickname);
				s.avatar = this.avatar(avatar);
				s.roomKey = key;
				s.ownerWsId = room.ownerWsId;
				delete s.status;
				this.changed(s);
				this.send(room.ownerWsId, "onconnection", id);
				this.updateRooms();
				break;
			}
			case "changeAvatar":
				s.nickname = this.nickname(args[0]);
				s.avatar = this.avatar(args[1]);
				this.changed(s);
				this.updateClients();
				break;
			case "config": {
				const room = s.roomKey && this.rooms.get(s.roomKey);
				const config = args[0];
				if (room && room.ownerWsId === id && config && typeof config === "object" && !Array.isArray(config) && JSON.stringify(config).length <= 512 * 1024) {
					room.config = config;
					room.servermode = false;
					this.hooks.topologyChanged();
					this.updateRooms();
				}
				break;
			}
			case "status":
				if (typeof args[0] === "string") s.status = args[0].slice(0, 256);
				else delete s.status;
				this.changed(s);
				this.updateClients();
				break;
			case "send":
				if (this.clients.get(args[0])?.state.ownerWsId === id && typeof args[1] === "string") this.sendRaw(args[0], args[1]);
				break;
			case "close":
				if (this.clients.get(args[0])?.state.ownerWsId === id) this.close(args[0]);
				break;
			case "events":
				this.handleEvents(s, args);
				break;
		}
	}
	handleEvents(s: Session, [config, id, type]: any[]) {
		if (id !== s.onlineKey || this.bannedKeys.has(id)) {
			this.close(s.wsid);
			return;
		}
		let changed = false;
		if (typeof config === "string") {
			for (const ev of this.events)
				if (ev.id === config) {
					if (type === "join" && !ev.members.includes(id)) {
						ev.members.push(id);
						changed = true;
					}
					if (type === "leave") {
						ev.members = ev.members.filter(m => m !== id);
						changed = true;
					}
				}
			this.events = this.events.filter(e => e.members.length);
		} else if (config && typeof config === "object" && Number.isFinite(config.utc) && typeof config.content === "string" && config.content.length <= 2000) {
			if (this.events.length >= 20) this.send(s.wsid, "eventsdenied", "total");
			else if (config.utc <= this.now()) this.send(s.wsid, "eventsdenied", "time");
			else if (this.bannedWords.some(w => config.content.includes(w))) this.send(s.wsid, "eventsdenied", "ban");
			else {
				this.events.unshift({ id: this.id(), creator: id, nickname: this.nickname(config.nickname), avatar: this.avatar(config.avatar), utc: config.utc, day: Number(config.day) || 0, hour: Number(config.hour) || 0, content: config.content, members: [id] });
				changed = true;
			}
		}
		if (changed) this.updateEvents();
	}
	disconnect(id: string) {
		const c = this.clients.get(id);
		if (!c) return;
		const s = c.state;
		this.clients.delete(id);
		for (const [key, room] of this.rooms)
			if (room.ownerWsId === id) {
				this.rooms.delete(key);
				for (const { state: member } of this.clients.values())
					if (member.roomKey === key) {
						delete member.roomKey;
						delete member.ownerWsId;
						this.changed(member);
						this.send(member.wsid, "selfclose");
					}
				this.hooks.topologyChanged();
			}
		if (s.ownerWsId) this.send(s.ownerWsId, "onclose", id);
		s.roomKey ? this.updateRooms() : this.updateClients();
	}
	tick() {
		let topology = false;
		for (const { state: s } of [...this.clients.values()]) {
			if (s.keyDeadline && s.keyDeadline <= this.now()) {
				this.send(s.wsid, "denied", "key");
				this.close(s.wsid);
				continue;
			}
			if (s.heartbeatAt <= this.now()) {
				if (s.awaitingHeartbeat) {
					this.close(s.wsid);
					continue;
				}
				s.awaitingHeartbeat = true;
				s.heartbeatAt = this.now() + 60000;
				this.changed(s);
				this.sendRaw(s.wsid, "heartbeat");
			}
		}
		const n = this.events.length;
		this.pruneEvents();
		if (n !== this.events.length) {
			topology = true;
			this.updateEvents();
		}
		return topology;
	}
	nextAlarm() {
		let next = Infinity;
		for (const { state: s } of this.clients.values()) next = Math.min(next, s.keyDeadline || Infinity, s.heartbeatAt);
		for (const e of this.events) next = Math.min(next, e.utc);
		return Number.isFinite(next) ? next : null;
	}
}
