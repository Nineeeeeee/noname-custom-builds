import { RUNTIME, SHELL, type ReleaseState } from "./protocol";
export function workerMessage<T>(data: unknown, target = navigator.serviceWorker.controller): Promise<T> {
	return new Promise((resolve, reject) => {
		if (!target) {
			reject(new Error("离线服务尚未控制页面"));
			return;
		}
		const channel = new MessageChannel();
		const timeout = setTimeout(() => reject(new Error("离线服务响应超时")), 20000);
		channel.port1.onmessage = e => {
			clearTimeout(timeout);
			channel.port1.close();
			e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
		};
		target.postMessage(data, [channel.port2]);
	});
}
export async function ensureController(update = false) {
	if (!("serviceWorker" in navigator) || !("caches" in globalThis) || !("indexedDB" in globalThis) || !crypto.subtle) throw new Error("浏览器不支持完整离线存储，请使用新版 Chrome、Edge 或 Safari");
	let registration = navigator.serviceWorker.controller ? await navigator.serviceWorker.getRegistration("/") : undefined;
	if (!registration) registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" });
	else if (update) await registration.update();
	await navigator.serviceWorker.ready;
	if (!navigator.serviceWorker.controller)
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("离线服务启动超时，请重新打开")), 20000);
			navigator.serviceWorker.addEventListener(
				"controllerchange",
				() => {
					clearTimeout(timeout);
					resolve();
				},
				{ once: true }
			);
			if (navigator.serviceWorker.controller) {
				clearTimeout(timeout);
				resolve();
			}
		});
	const handshake = await workerMessage<{ runtime: number; shell: number }>({ type: "handshake" });
	if (handshake.runtime !== RUNTIME || handshake.shell !== SHELL) throw new Error("启动器和离线服务版本不兼容，请关闭游戏窗口后更新");
	return registration;
}
export async function onlineState(): Promise<ReleaseState | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	try {
		const response = await fetch("/__pwa/status", { cache: "no-store", signal: controller.signal });
		if (response.status === 401) return { state: "maintenance", invitationRequired: true, message: "下载和更新需要邀请码" } as ReleaseState;
		if (!response.ok) return { state: "maintenance", message: "服务器暂不可用，请稍后重试" } as ReleaseState;
		const state = (await response.json()) as ReleaseState;
		if (!["ready", "maintenance"].includes(state.state) || state.schemaVersion !== 1 || state.runtimeProtocol !== RUNTIME || state.shellProtocol !== SHELL) return { state: "maintenance", message: "启动器需要更新，请关闭其他游戏窗口后重新打开" } as ReleaseState;
		return state;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}
