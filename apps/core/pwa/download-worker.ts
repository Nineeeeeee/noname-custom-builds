/// <reference lib="WebWorker" />
import { unzipSync } from "fflate";
import { validateManifest, sha256, type ReleaseManifest } from "./protocol";
import { acquireLease, releaseLease, renewLease, withLease, missingObjects, saveObject, type Lease } from "./storage";
let busy = false,
	cancelled = false;
const controllers = new Set<AbortController>();
const abortDownloads = () => {
	for (const controller of controllers) controller.abort();
};
const report = (message: unknown) => postMessage(message);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function download(url: string, size: number): Promise<Uint8Array> {
	for (let attempt = 0; attempt < 5; attempt++) {
		if (cancelled) throw new Error("下载已暂停，下次打开可继续");
		let retryMs = 0;
		try {
			const controller = new AbortController();
			controllers.add(controller);
			const timeout = setTimeout(() => controller.abort(), 120000);
			try {
				const response = await fetch(url, { cache: "no-store", signal: controller.signal });
				if (response.status === 503) throw new Error("服务器正在维护，请稍后继续");
				if (response.status === 410) throw new Error("发行版已更新，请重新检查更新");
				if (!response.ok || response.status === 206) {
					retryMs = Number(response.headers.get("retry-after")) * 1000 || 0;
					throw new Error(`下载失败 (${response.status})`);
				}
				const reader = response.body!.getReader();
				const bytes = new Uint8Array(size);
				let offset = 0;
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					if (offset + value.length > size) {
						await reader.cancel();
						throw new Error("下载大小超出清单");
					}
					bytes.set(value, offset);
					offset += value.length;
				}
				if (offset !== size) throw new Error("下载不完整");
				return bytes;
			} finally {
				clearTimeout(timeout);
				controllers.delete(controller);
			}
		} catch (error) {
			if (cancelled || /维护|发行版/.test(String(error)) || attempt === 4) throw error;
			await pause(retryMs || Math.min(1000 * 2 ** attempt, 16000) + Math.random() * 500);
		}
	}
	throw new Error("下载失败");
}
async function install(m: ReleaseManifest, deep: boolean) {
	validateManifest(m);
	const lease = await acquireLease(crypto.randomUUID());
	let finished: { type: string; releaseId: string; downloadedBytes: number } | undefined;
	let leaseError: unknown;
	const timer = setInterval(() => {
		renewLease(lease).catch(error => {
			leaseError = error;
			cancelled = true;
			abortDownloads();
		});
	}, 15000);
	const assertLease = async () => {
		if (leaseError) throw leaseError;
		if (cancelled) throw new Error("下载已暂停，下次打开可继续");
		await renewLease(lease);
	};
	try {
		const missing = await missingObjects(m, deep, (done, total) => report({ type: "verify", done, total }));
		const records = new Map(Object.values(m.files).map(f => [f.sha256, f]));
		const total = [...missing].reduce((n, h) => n + records.get(h)!.size, 0);
		let completed = 0;
		const estimate = await navigator.storage?.estimate?.();
		if (estimate?.quota && estimate.quota - (estimate.usage || 0) < total + 96 * 1024 * 1024) throw new Error("存储空间不足。请释放空间后继续，建议至少保留 3 GB 可用空间");
		report({ type: "progress", completed, total });
		await withLease<void>(lease, ["meta", "releases"], tx => {
			tx.objectStore("meta").put(m.releaseId, "installTarget");
			tx.objectStore("releases").put(m, m.releaseId);
		});
		const tasks: (() => Promise<void>)[] = [];
		const assigned = new Set<string>();
		let unpackQueue = Promise.resolve();
		async function store(hash: string, bytes: Uint8Array) {
			if (!missing.has(hash)) return;
			await assertLease();
			const f = records.get(hash)!;
			await saveObject(hash, bytes, f.size);
			await withLease<void>(lease, ["downloads"], tx => {
				tx.objectStore("downloads").put({ size: f.size, checkedAt: Date.now() }, [m.releaseId, hash]);
			});
			missing.delete(hash);
			completed += f.size;
			report({ type: "progress", completed, total });
		}
		for (const pack of Object.values(m.packs)) {
			const needed = pack.files.filter(p => missing.has(m.files[p].sha256) && !assigned.has(m.files[p].sha256));
			if (!needed.length) continue;
			const neededBytes = [...new Set(needed.map(p => m.files[p].sha256))].reduce((n, h) => n + records.get(h)!.size, 0);
			// Small differences always use individual objects, never whole changed packs.
			if (neededBytes < pack.size * 0.6) continue;
			for (const p of needed) assigned.add(m.files[p].sha256);
			tasks.push(async () => {
				const bytes = await download(`/__pwa/packs/${pack.sha256}?releaseId=${encodeURIComponent(m.releaseId)}`, pack.size);
				if ((await sha256(bytes as BufferSource)) !== pack.sha256) throw new Error("安装包校验失败");
				const task = unpackQueue.then(async () => {
					let unpackBytes = 0,
						count = 0;
					const unzipped = unzipSync(bytes, {
						filter: file => {
							const record = m.files[file.name];
							if (!record || !pack.files.includes(file.name) || file.originalSize !== record.size || file.compression !== 0 || ++count > pack.files.length) throw new Error("安装包内容不符");
							unpackBytes += file.originalSize;
							if (unpackBytes > pack.size) throw new Error("安装包解压大小超限");
							return true;
						},
					});
					if (Object.keys(unzipped).length !== pack.files.length) throw new Error("安装包条目缺失");
					for (const name of pack.files) {
						const f = m.files[name],
							data = unzipped[name];
						if (data.length !== f.size || (await sha256(data as BufferSource)) !== f.sha256) throw new Error("安装文件校验失败");
						await store(f.sha256, data);
						delete unzipped[name];
					}
				});
				unpackQueue = task.catch(() => {});
				await task;
			});
		}
		for (const hash of missing)
			if (!assigned.has(hash))
				tasks.push(async () => {
					const f = records.get(hash)!;
					await store(hash, await download(`/__pwa/objects/${hash}?releaseId=${encodeURIComponent(m.releaseId)}`, f.size));
				});
		let next = 0,
			failure: unknown;
		await Promise.all(
			[0, 1].map(async () => {
				while (!failure && next < tasks.length) {
					const task = tasks[next++];
					try {
						await task();
					} catch (error) {
						failure = error;
					}
				}
			})
		);
		if (failure) throw failure;
		if ((await missingObjects(m)).size) throw new Error("安装文件缺失，请继续下载或完整性修复");
		await assertLease();
		await withLease<void>(lease, ["meta", "releases"], tx => {
			tx.objectStore("releases").put(m, m.releaseId);
			tx.objectStore("meta").put(m.releaseId, "activeRelease");
			tx.objectStore("meta").delete("installTarget");
		});
		finished = { type: "complete", releaseId: m.releaseId, downloadedBytes: completed };
	} finally {
		clearInterval(timer);
		await releaseLease(lease);
	}
	if (finished) report(finished);
}
self.onmessage = async event => {
	if (event.data.type === "cancel") {
		cancelled = true;
		abortDownloads();
		return;
	}
	if (event.data.type !== "install" || busy) return;
	busy = true;
	cancelled = false;
	try {
		await install(event.data.manifest, !!event.data.deep);
	} catch (error) {
		report({ type: "error", message: error instanceof Error && error.name === "QuotaExceededError" ? "浏览器存储空间不足，请释放空间后继续" : String(error instanceof Error ? error.message : error) });
	} finally {
		busy = false;
	}
};
