import { FileSystem, installLegacyFileSystemAPI } from "../library/fs";
import { PwaAdapter } from "../../pwa/filesystem";
import { activeManifest, get, missingObjects } from "../../pwa/storage";
import { onlineState, workerMessage } from "../../pwa/client";
declare const __LOBBY_URL__: string;
export default async function pwaReady({ lib, game }: any) {
	if (!navigator.serviceWorker.controller) {
		location.replace("/launcher.html");
		throw new Error("请通过启动器进入游戏");
	}
	const explicit = new URL(location.href).searchParams.get("release");
	const m = explicit ? await get<any>("releases", explicit) : await activeManifest();
	const state = await onlineState();
	if (!m || state?.state === "maintenance" || (state && state.releaseId !== m.releaseId) || (await missingObjects(m)).size) {
		location.replace("/launcher.html");
		throw new Error("请完成安装或更新");
	}
	await workerMessage({ type: "pin", releaseId: m.releaseId });
	lib.path = (await import("path-browserify-esm")).default;
	const adapter = new PwaAdapter(m);
	lib.fs = new FileSystem(adapter);
	installLegacyFileSystemAPI(game, lib.fs);
	lib.pwa = true;
	lib.hallURL = __LOBBY_URL__;
	game.pwaInstallExtension = (name: string, zip: any) => adapter.installExtension(name, zip);
	game.pwaFileRevision = async () => (await get<string>("meta", "userRevision")) || "0";
	game.download = (url: string, folder: string, onsuccess: () => void, onerror: (e: unknown) => void, _dev: unknown, onprogress?: (loaded: number, total: number) => void) => {
		(async () => {
			const response = await fetch(url);
			if (!response.ok || response.status === 206) throw new Error(`下载失败 (${response.status})`);
			const total = Number(response.headers.get("content-length")) || 0;
			const chunks: Uint8Array[] = [];
			let loaded = 0;
			const reader = response.body!.getReader();
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				chunks.push(next.value);
				loaded += next.value.length;
				onprogress?.(loaded, total);
			}
			const bytes = new Uint8Array(loaded);
			let offset = 0;
			for (const c of chunks) {
				bytes.set(c, offset);
				offset += c.length;
			}
			await adapter.createDir(lib.path.dirname(folder), { recursive: true });
			await adapter.write(folder, bytes);
			onsuccess?.();
		})().catch(error => onerror?.(error));
	};
	game.export = (data: string | Blob, name = "noname") => {
		const blob = typeof data === "string" ? new Blob([data], { type: "text/plain" }) : data;
		const link = document.createElement("a");
		link.download = name.replace(/[\\/:?"*<>|]/g, "-");
		const object = URL.createObjectURL(blob);
		link.href = object;
		link.click();
		setTimeout(() => URL.revokeObjectURL(object), 60000);
	};
	game.open = (url: string) => window.open(url, "_blank", "noopener");
	game.exit = () => {
		window.onbeforeunload = null;
		location.href = "/launcher.html";
	};
	let notice: HTMLElement | undefined;
	const showNotice = (text: string) => {
		if (!notice) {
			notice = document.createElement("button");
			Object.assign(notice.style, { position: "fixed", top: "8px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", background: "#d2ad63", color: "#17110b", padding: "12px", border: "0", borderRadius: "8px" });
			notice.onclick = () => {
				if (confirm("返回启动器会结束当前游戏，是否继续？")) {
					window.onbeforeunload = null;
					location.href = "/launcher.html";
				}
			};
			document.body.appendChild(notice);
		}
		notice.textContent = text;
	};
	navigator.serviceWorker.addEventListener("message", event => {
		if (event.data.type === "repair") showNotice("发现缺失资源，点击返回启动器修复");
	});
	const poll = async () => {
		if (document.hidden) return;
		const state = await onlineState();
		if (state?.state === "maintenance") showNotice(state.message || "服务器正在维护，点击返回启动器");
		else if (state && state.releaseId !== m.releaseId) showNotice("游戏有更新，点击返回启动器完成更新");
	};
	setInterval(poll, 60000);
	document.addEventListener("visibilitychange", poll);
}
