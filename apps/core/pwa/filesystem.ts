import type { FileSystemAdapter, FileHandle, OpenOptions, FileInfo, DirEntry } from "../noname/library/fs";
import { FileSystemError, FileSystemErrorCode as Code } from "../noname/library/fs/errors";
import { normalizePath, safeArchivePath, type ReleaseManifest } from "./protocol";
import { get, entries, readLocal, isDeleted, transaction, type UserFile } from "./storage";
function fail(code: Code, path: string): never {
	throw new FileSystemError(code, path);
}
const parent = (path: string) => path.split("/").slice(0, -1).join("/");
export class PwaAdapter implements FileSystemAdapter {
	constructor(public manifest: ReleaseManifest) {}
	async read(input: string): Promise<Uint8Array> {
		const path = normalizePath(input);
		const local = await readLocal(path, this.manifest);
		if (!local) fail(Code.NotFound, path);
		return new Uint8Array(await local.response.arrayBuffer());
	}
	async write(input: string, bytes: Uint8Array): Promise<void> {
		const path = normalizePath(input);
		if (!path) fail(Code.InvalidPath, path);
		const info = await this.stat(path);
		if (info?.type === "directory") fail(Code.NotFile, path);
		if ((await this.stat(parent(path)))?.type !== "directory") fail(Code.NotDirectory, parent(path));
		await transaction<void>(["userFiles", "meta"], tx => {
			tx.objectStore("userFiles").put({ blob: new Blob([bytes as BlobPart]), revision: crypto.randomUUID(), modified: Date.now() }, path);
			tx.objectStore("meta").put(crypto.randomUUID(), "userRevision");
		});
		// An explicit user write overrides a tombstone, but does not resurrect siblings.
	}
	async stat(input: string): Promise<FileInfo | null> {
		const path = normalizePath(input);
		const user = await get<UserFile>("userFiles", path);
		if (user) return { type: "file", size: user.blob.size, modifiedAt: new Date(user.modified) };
		if (path === "" || (await get("userDirs", path))) return { type: "directory" };
		if (await isDeleted(path)) return null;
		if (this.manifest.files[path]) return { type: "file", size: this.manifest.files[path].size };
		if (this.manifest.directories.includes(path)) return { type: "directory" };
		return null;
	}
	async list(input: string): Promise<DirEntry[]> {
		const path = normalizePath(input);
		if ((await this.stat(path))?.type !== "directory") fail(Code.NotDirectory, path);
		const userFiles = new Map(await entries<UserFile>("userFiles")),
			userDirs = new Map(await entries("userDirs"));
		const tombs = new Map(await entries<{ directory: boolean }>("tombstones"));
		const deleted = (name: string) => [...tombs].some(([t, v]) => name === t || (v.directory && name.startsWith(t + "/")));
		const candidates = new Map<string, "file" | "directory">();
		const prefix = path ? path + "/" : "";
		for (const [name, type] of [...Object.keys(this.manifest.files).map(n => [n, "file"] as const), ...this.manifest.directories.map(n => [n, "directory"] as const), ...[...userFiles.keys()].map(n => [n, "file"] as const), ...[...userDirs.keys()].map(n => [n, "directory"] as const)]) {
			if (!name.startsWith(prefix) || name === path) continue;
			if (!userFiles.has(name) && !userDirs.has(name) && deleted(name)) continue;
			const child = name.slice(prefix.length).split("/")[0];
			const nested = name.slice(prefix.length).includes("/");
			candidates.set(child, nested ? "directory" : type);
		}
		return [...candidates].sort(([a], [b]) => a.localeCompare(b)).map(([name, type]) => ({ name, type }));
	}
	async createDir(input: string, options = {} as { recursive?: boolean }): Promise<void> {
		const path = normalizePath(input);
		if (!path) return;
		const info = await this.stat(path);
		if (info?.type === "file") fail(Code.NotDirectory, path);
		if (info && !options.recursive) fail(Code.AlreadyExists, path);
		if (!options.recursive && (await this.stat(parent(path)))?.type !== "directory") fail(Code.NotDirectory, parent(path));
		const dirs: string[] = [];
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const dir = parts.slice(0, i).join("/");
			if ((await this.stat(dir))?.type === "file") fail(Code.NotDirectory, dir);
			dirs.push(dir);
		}
		await transaction<void>(["userDirs"], tx => {
			for (const dir of dirs) tx.objectStore("userDirs").put(true, dir);
		});
	}
	async remove(input: string, options = {} as { recursive?: boolean }): Promise<void> {
		const path = normalizePath(input);
		if (!path) fail(Code.PermissionDenied, path);
		const info = await this.stat(path);
		if (!info) fail(Code.NotFound, path);
		if (info.type === "directory" && !options.recursive && (await this.list(path)).length) fail(Code.IoError, path);
		const files = await entries("userFiles"),
			dirs = await entries("userDirs");
		await transaction<void>(["userFiles", "userDirs", "tombstones", "meta"], tx => {
			tx.objectStore("meta").put(crypto.randomUUID(), "userRevision");
			for (const [name] of files) if (name === path || (info.type === "directory" && name.startsWith(path + "/"))) tx.objectStore("userFiles").delete(name);
			for (const [name] of dirs) if (name === path || (info.type === "directory" && name.startsWith(path + "/"))) tx.objectStore("userDirs").delete(name);
			tx.objectStore("tombstones").put({ directory: info.type === "directory" }, path);
		});
	}
	/** Atomic overlay installation: bytes are fully prepared before the transaction. */
	async installExtension(name: string, zip: { files: Record<string, { dir: boolean; asArrayBuffer(): ArrayBuffer }> }): Promise<void> {
		if (!name || safeArchivePath(name) !== name || name.includes("/")) fail(Code.InvalidPath, name);
		const root = `extension/${name}`;
		const prepared: [string, Blob][] = [];
		const dirs = new Set(["extension", root]);
		let total = 0;
		for (const [relative, entry] of Object.entries(zip.files)) {
			const clean = safeArchivePath(relative);
			const path = `${root}/${clean}`;
			if (entry.dir) dirs.add(path);
			else {
				const blob = new Blob([entry.asArrayBuffer()]);
				total += blob.size;
				if (total > 512 * 1024 * 1024 || prepared.length >= 20000) throw new Error("扩展包过大");
				prepared.push([path, blob]);
			}
			let directory = parent(path);
			while (directory) {
				dirs.add(directory);
				directory = parent(directory);
			}
		}
		const oldFiles = await entries("userFiles"),
			oldDirs = await entries("userDirs");
		await transaction<void>(["userFiles", "userDirs", "tombstones", "meta"], tx => {
			tx.objectStore("meta").put(crypto.randomUUID(), "userRevision");
			for (const [p] of oldFiles) if (p.startsWith(root + "/")) tx.objectStore("userFiles").delete(p);
			for (const [p] of oldDirs) if (p === root || p.startsWith(root + "/")) tx.objectStore("userDirs").delete(p);
			tx.objectStore("tombstones").put({ directory: true }, root);
			for (const d of dirs) tx.objectStore("userDirs").put(true, d);
			for (const [p, blob] of prepared) tx.objectStore("userFiles").put({ blob, revision: crypto.randomUUID(), modified: Date.now() }, p);
		});
	}
	async open(input: string, options: OpenOptions = {}): Promise<FileHandle> {
		const path = normalizePath(input);
		const writable = !!(options.write || options.append),
			readable = options.read ?? !writable;
		if ((!readable && !writable) || (!writable && (options.create || options.createNew || options.truncate))) fail(Code.PermissionDenied, path);
		const info = await this.stat(path);
		if (options.createNew && info) fail(Code.AlreadyExists, path);
		if (info && info.type !== "file") fail(Code.NotFile, path);
		if (!info && !options.create && !options.createNew) fail(Code.NotFound, path);
		if (!info || options.truncate) await this.write(path, new Uint8Array());
		let closed = false;
		const assert = (write = false) => {
			if (closed || (write && !writable) || (!write && !readable)) fail(Code.PermissionDenied, path);
		};
		return {
			readAll: async () => {
				assert();
				return this.read(path);
			},
			write: async data => {
				assert(true);
				if (options.append) {
					const old = await this.read(path);
					const all = new Uint8Array(old.length + data.length);
					all.set(old);
					all.set(data, old.length);
					data = all;
				}
				await this.write(path, data);
			},
			stat: async () => {
				if (closed) fail(Code.IoError, path);
				return (await this.stat(path)) || fail(Code.NotFound, path);
			},
			truncate: async (size = 0) => {
				assert(true);
				if (!Number.isSafeInteger(size) || size < 0) fail(Code.InvalidPath, path);
				const data = new Uint8Array(size);
				data.set((await this.read(path)).subarray(0, size));
				await this.write(path, data);
			},
			close: async () => {
				closed = true;
			},
		};
	}
}
