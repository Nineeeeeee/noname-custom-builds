import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PwaAdapter } from "../../apps/core/pwa/filesystem.ts";
import { normalizePath, safeArchivePath, sha256, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";
import { saveObject, get, put, acquireLease, renewLease, releaseLease, missingObjects, CONTENT_CACHE } from "../../apps/core/pwa/storage.ts";
import { parseRange, localResponse } from "../../apps/core/pwa/range.ts";
(globalThis as any).location = { origin: "https://test.invalid" };
const contents = new Map<string, Response>();
const cache = {
	put: async (key: string | Request, value: Response) => {
		contents.set(typeof key === "string" ? new URL(key, location.origin).href : key.url, value.clone());
	},
	match: async (key: string | Request) => contents.get(typeof key === "string" ? new URL(key, location.origin).href : key.url)?.clone(),
	keys: async () => [...contents.keys()].map(k => new Request(k)),
	delete: async (key: string | Request) => contents.delete(typeof key === "string" ? key : key.url),
};
(globalThis as any).caches = { open: async () => cache };
let manifest: ReleaseManifest;
test("path validation, full content cache and merged filesystem; recursive tombstones survive updates", async () => {
	assert.equal(normalizePath("./extension/中文/../中文/a.ts"), "extension/中文/a.ts");
	assert.throws(() => normalizePath("../../escape"));
	assert.throws(() => safeArchivePath("foo/../bar"));
	assert.throws(() => safeArchivePath("/absolute"));
	const data = new TextEncoder().encode("original");
	const hash = await sha256(data);
	await saveObject(hash, data, data.length);
	manifest = { schemaVersion: 1, releaseId: "one", commit: "test", gameVersion: "test", runtimeProtocol: 1, compilerVersion: "test", entry: "index.html", fileCount: 2, totalBytes: 16, files: { "extension/中文/a.ts": { sha256: hash, size: 8, contentType: "text/plain" }, "extension/中文/b.ts": { sha256: hash, size: 8, contentType: "text/plain" } }, directories: ["", "extension", "extension/中文", "empty"], packs: {} };
	const fs = new PwaAdapter(manifest);
	assert.equal(new TextDecoder().decode(await fs.read("extension/中文/a.ts")), "original");
	await fs.write("extension/中文/a.ts", new TextEncoder().encode("edited"));
	assert.equal(new TextDecoder().decode(await fs.read("extension/中文/a.ts")), "edited");
	await fs.remove("extension/中文", { recursive: true });
	assert.equal(await fs.stat("extension/中文/a.ts"), null);
	assert.equal(await fs.stat("extension/中文"), null);
	await fs.createDir("extension/中文/new/empty", { recursive: true });
	await fs.write("extension/中文/new/a.ts", data);
	assert.equal(await fs.stat("extension/中文/b.ts"), null);
	assert.deepEqual(await fs.list("extension/中文"), [{ name: "new", type: "directory" }]);
	const next = new PwaAdapter({ ...manifest, releaseId: "two" });
	assert.equal(await next.stat("extension/中文/b.ts"), null);
	assert.equal((await next.stat("extension/中文/new/a.ts"))?.type, "file");
	assert.deepEqual(await fs.list("empty"), []);
});
test("open flags, append, zero-filled truncate and atomic extension import rollback on invalid archive", async () => {
	const fs = new PwaAdapter(manifest);
	await fs.createDir("custom", { recursive: true });
	const handle = await fs.open("custom/test", { createNew: true, write: true, append: true });
	await handle.write(new Uint8Array([1, 2]));
	await handle.write(new Uint8Array([3]));
	assert.deepEqual(await fs.read("custom/test"), new Uint8Array([1, 2, 3]));
	await handle.truncate(5);
	assert.deepEqual(await fs.read("custom/test"), new Uint8Array([1, 2, 3, 0, 0]));
	await handle.close();
	await assert.rejects(handle.write(new Uint8Array()));
	await assert.rejects(fs.open("custom/test", { createNew: true, write: true }));
	await fs.installExtension("atomic", { files: { "extension.ts": { dir: false, asArrayBuffer: () => new TextEncoder().encode("export default 42").buffer } } });
	const before = await fs.read("extension/atomic/extension.ts");
	await assert.rejects(fs.installExtension("atomic", { files: { "../escape.ts": { dir: false, asArrayBuffer: () => new ArrayBuffer(0) } } }));
	assert.deepEqual(await fs.read("extension/atomic/extension.ts"), before);
	assert.ok(await get("meta", "userRevision"));
});
test("lease fencing, expiration recovery, cache/database disagreement and deep corruption detection", async () => {
	const a = await acquireLease("a");
	await assert.rejects(acquireLease("b"));
	await put("locks", "install", { ...a, expires: Date.now() - 1 });
	const b = await acquireLease("b");
	assert.ok(b.generation > a.generation);
	await assert.rejects(renewLease(a));
	await releaseLease(b);
	assert.equal((await missingObjects(manifest)).size, 0);
	const file = Object.values(manifest.files)[0];
	const key = [...contents.keys()][0];
	await cache.put(key, new Response("wrong123", { headers: { "Content-Length": "8" } }));
	assert.equal((await missingObjects(manifest)).size, 0);
	assert.deepEqual([...(await missingObjects(manifest, true))], [file.sha256]);
	contents.clear();
	await put("downloads", [manifest.releaseId, file.sha256], { size: file.size });
	assert.deepEqual([...(await missingObjects(manifest))], [file.sha256]);
});
test("Range, suffix, open end, HEAD, multi-range and unsatisfiable requests", async () => {
	assert.deepEqual(parseRange("bytes=3-", 10), { start: 3, end: 9 });
	assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
	assert.equal(parseRange("bytes=10-", 10), false);
	assert.equal(parseRange("bytes=0-1,3-4", 10), null);
	const r = await localResponse(new Response("0123456789"), new Request("https://test.invalid/audio/a.mp3", { headers: { Range: "bytes=3-5" } }), "audio/mpeg", 10);
	assert.equal(r.status, 206);
	assert.equal(await r.text(), "345");
	assert.equal(r.headers.get("content-range"), "bytes 3-5/10");
	const head = await localResponse(new Response("0123456789"), new Request("https://test.invalid/audio/a.mp3", { method: "HEAD", headers: { Range: "bytes=-3" } }), "audio/mpeg", 10);
	assert.equal(head.status, 206);
	assert.equal(await head.text(), "");
	assert.equal(head.headers.get("content-length"), "3");
	const bad = await localResponse(new Response("0123456789"), new Request("https://test.invalid/audio/a.mp3", { headers: { Range: "bytes=15-" } }), "audio/mpeg", 10);
	assert.equal(bad.status, 416);
});
