import { normalizePath, sha256, type ReleaseManifest } from "./protocol";
export const DB_NAME = "noname-pwa-v1";
export const CONTENT_CACHE = "noname-pwa-content-v1";
export const COMPILED_CACHE = "noname-pwa-compiled-v1";
const stores = ["meta", "releases", "downloads", "userFiles", "userDirs", "tombstones", "clients", "locks"] as const;
export type Store = (typeof stores)[number];
let database: Promise<IDBDatabase> | undefined;
export function db(): Promise<IDBDatabase> {
	return (database ||= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			for (const name of stores) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
		};
		request.onsuccess = () => {
			request.result.onclose = () => { database = undefined; };
			request.result.onversionchange = () => {
				request.result.close();
				database = undefined;
			};
			resolve(request.result);
		};
		request.onerror = () => {
			database = undefined;
			reject(request.error);
		};
	}));
}
export async function transaction<T>(names: Store[], action: (tx: IDBTransaction, result: (value: T) => void, abort: (reason: Error) => void) => void): Promise<T> {
	const database = await db();
	return new Promise((resolve, reject) => {
		const tx = database.transaction(names, "readwrite");
		let value: T;
		let reason: Error | undefined;
		const abort = (error: Error) => {
			reason = error;
			tx.abort();
		};
		tx.oncomplete = () => resolve(value);
		tx.onabort = () => reject(reason || tx.error || new Error("浏览器中断了本地写入，请重新打开启动器继续下载"));
		try {
			action(tx, result => {
				value = result;
			}, abort);
		} catch (error) {
			abort(error instanceof Error ? error : new Error(String(error)));
		}
	});
}
export async function get<T>(store: Store, key: IDBValidKey): Promise<T | undefined> {
	const database = await db();
	return new Promise((resolve, reject) => {
		const r = database.transaction(store).objectStore(store).get(key);
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}
export async function put(store: Store, key: IDBValidKey, value: unknown): Promise<void> {
	await transaction<void>([store], tx => {
		tx.objectStore(store).put(value, key);
	});
}
export async function entries<T>(store: Store): Promise<[string, T][]> {
	const database = await db();
	return new Promise((resolve, reject) => {
		const output: [string, T][] = [];
		const r = database.transaction(store).objectStore(store).openCursor();
		r.onsuccess = () => {
			const c = r.result;
			if (c) {
				output.push([String(c.key), c.value]);
				c.continue();
			} else resolve(output);
		};
		r.onerror = () => reject(r.error);
	});
}
export async function activeManifest(): Promise<ReleaseManifest | undefined> {
	const id = await get<string>("meta", "activeRelease");
	return id ? get<ReleaseManifest>("releases", id) : undefined;
}
export const objectKey = (hash: string) => new URL(`/__pwa/cache/sha256/${hash}`, location.origin).href;
export async function saveObject(hash: string, bytes: Uint8Array, expectedSize: number): Promise<void> {
	if (bytes.byteLength !== expectedSize || (await sha256(bytes as BufferSource)) !== hash) throw new Error("下载校验失败，请重试");
	await (await caches.open(CONTENT_CACHE)).put(objectKey(hash), new Response(bytes as BodyInit, { headers: { "Content-Length": String(bytes.byteLength) } }));
}
export interface UserFile {
	blob: Blob;
	revision: string;
	modified: number;
}
export async function isDeleted(path: string): Promise<boolean> {
	const exact = await get<{ directory: boolean }>("tombstones", path);
	if (exact) return true;
	const parts = path.split("/");
	parts.pop();
	while (parts.length) {
		if ((await get<{ directory: boolean }>("tombstones", parts.join("/")))?.directory) return true;
		parts.pop();
	}
	return false;
}
export async function readLocal(input: string, manifest: ReleaseManifest): Promise<{ response: Response; hash: string; size: number; user: boolean } | null> {
	const path = normalizePath(input);
	const user = await get<UserFile>("userFiles", path);
	if (user) return { response: new Response(user.blob), hash: user.revision, size: user.blob.size, user: true };
	if (await isDeleted(path)) return null;
	const file = manifest.files[path];
	if (!file) return null;
	const response = await (await caches.open(CONTENT_CACHE)).match(objectKey(file.sha256));
	if (!response || Number(response.headers.get("content-length")) !== file.size) return null;
	return { response, hash: file.sha256, size: file.size, user: false };
}
export interface Lease {
	owner: string;
	generation: number;
	expires: number;
}
export class LeaseBusyError extends Error {
	constructor() { super("另一个窗口正在下载或清理文件，请稍后再试"); this.name = "LeaseBusyError"; }
}
export class LeaseLostError extends Error {
	constructor() { super("下载已被另一个窗口接管，请在当前窗口重新点击继续下载"); this.name = "LeaseLostError"; }
}
export async function acquireLease(owner: string): Promise<Lease> {
	return transaction(["locks"], (tx, result, abort) => {
		const store = tx.objectStore("locks");
		const r = store.get("install");
		r.onsuccess = () => {
			const old = r.result as Lease | undefined;
			if (old && old.owner !== owner && old.expires > Date.now()) {
				abort(new LeaseBusyError());
				return;
			}
			const lease = { owner, generation: (old?.generation || 0) + 1, expires: Date.now() + 60000 };
			store.put(lease, "install");
			result(lease);
		};
	});
}
export async function withLease<T>(lease: Lease, stores: Store[], action: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
	return transaction(["locks", ...stores], (tx, result, abort) => {
		const r = tx.objectStore("locks").get("install");
		r.onsuccess = () => {
			const current = r.result as Lease | undefined;
			// Expiration allows another installer to take over. A suspended worker
			// can still renew its own lease if nobody actually took ownership.
			if (!current || current.owner !== lease.owner || current.generation !== lease.generation) {
				abort(new LeaseLostError());
				return;
			}
			current.expires = Date.now() + 60000;
			tx.objectStore("locks").put(current, "install");
			try {
				action(tx, result);
			} catch (error) {
				abort(error instanceof Error ? error : new Error(String(error)));
			}
		};
	});
}
export async function renewLease(lease: Lease) {
	await withLease<void>(lease, [], () => {});
}
export async function releaseLease(lease: Lease) {
	await withLease<void>(lease, [], tx => {
		tx.objectStore("locks").delete("install");
	}).catch(() => {});
}
export async function missingObjects(manifest: ReleaseManifest): Promise<Set<string>> {
	const cache = await caches.open(CONTENT_CACHE);
	const keys = new Set((await cache.keys()).map(r => r.url));
	const missing = new Set<string>();
	const unique = [...new Map(Object.values(manifest.files).map(f => [f.sha256, f])).values()];
	for (const f of unique) {
		if (!keys.has(objectKey(f.sha256))) missing.add(f.sha256);
	}
	return missing;
}
