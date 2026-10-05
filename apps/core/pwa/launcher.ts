import { type ReleaseManifest } from "./protocol";
import { activeManifest } from "./storage";
import { ensureController, onlineState, workerMessage } from "./client";
declare const __LOBBY_URL__: string;
const status = document.querySelector("#status")!,
	detail = document.querySelector("#detail")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const install = document.querySelector<HTMLButtonElement>("#install")!,
	play = document.querySelector<HTMLButtonElement>("#play")!,
	repair = document.querySelector<HTMLButtonElement>("#repair")!,
	pause = document.querySelector<HTMLButtonElement>("#pause")!;
const invitation = document.querySelector<HTMLFormElement>("#invitation")!;
let target: ReleaseManifest | undefined,
	active: ReleaseManifest | undefined,
	running = false,
	maintained = false;
let downloaded = 0;
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";
const worker = new Worker("/pwa/download-worker.js");
worker.onmessage = async e => {
	const data = e.data;
	if (data.type === "progress") {
		progress.value = data.total ? (data.completed / data.total) * 100 : 100;
		status.textContent = "正在下载完整游戏内容…";
		detail.textContent = `${mb(data.completed)} / ${mb(data.total)}，已下载文件会保留`;
	}
	if (data.type === "complete") {
		downloaded = data.downloadedBytes;
		running = false;
		pause.hidden = true;
		active = await activeManifest();
		status.textContent = "完整安装已就绪，可以离线游玩";
		detail.textContent = `游戏 ${active?.gameVersion} · 本次下载 ${mb(downloaded)}`;
		play.disabled = false;
		install.disabled = false;
		install.textContent = "检查更新";
		repair.disabled = false;
		progress.value = 100;
		void workerMessage({ type: "gc" }).catch(console.error);
	}
	if (data.type === "error") {
		running = false;
		pause.hidden = true;
		play.disabled = !active;
		status.textContent = data.message;
		detail.textContent = "已下载文件保留，重试会继续下载。";
		install.disabled = false;
		install.textContent = "继续下载 / 检查更新";
		repair.disabled = false;
	}
};
async function check(updates = false) {
	install.disabled = play.disabled = repair.disabled = true;
	maintained = false;
	target = undefined;
	const registration = await ensureController(updates);
	if (registration.waiting) {
		const result = await workerMessage<{ activated: boolean }>({ type: "activate" }, registration.waiting);
		if (result.activated) {
			location.reload();
			return;
		}
		status.textContent = "启动器有更新，请先关闭其他游戏窗口";
		install.disabled = false;
		return;
	}
	active = await activeManifest();
	// activeRelease is committed only after installation finishes. Starting an
	// installed game does not need a network round trip or a full cache scan.
	target = active;
	play.disabled = !active;
	install.disabled = false;
	repair.disabled = !active;
	invitation.hidden = true;
	if (active) {
		status.textContent = "完整安装已就绪，可以离线游玩";
		detail.textContent = `游戏 ${active.gameVersion}`;
		install.textContent = "检查更新";
		progress.value = 100;
		if (!updates) return;
	}
	const state = await onlineState();
	invitation.hidden = !state?.invitationRequired;
	if (state?.invitationRequired) {
		target = undefined;
		install.disabled = repair.disabled = true;
		status.textContent = active ? "本地完整安装可用；下载和更新需要邀请码" : "请输入朋友提供的邀请码，开始下载完整游戏";
		detail.textContent = "";
		return;
	}
	if (state?.state === "maintenance") {
		maintained = true;
		status.textContent = state.message || "服务器正在维护，请稍后再打开";
		install.disabled = false;
		install.textContent = "重新检查";
		return;
	}
	if (state && active?.releaseId !== state.releaseId) {
		const response = await fetch(`/__pwa/manifest?releaseId=${encodeURIComponent(state.releaseId)}`, { cache: "no-store" });
		if (!response.ok) throw new Error("发行内容暂不可用，请稍后重试");
		target = await response.json();
	} else {
		target = active;
	}
	repair.disabled = !target;
	install.disabled = !target;
	if (!state && !active) {
		status.textContent = "尚未完整安装，请联网完成下载";
		detail.textContent = "";
		return;
	}
	if (!state) {
		status.textContent = "当前离线，本地完整安装可用";
		detail.textContent = `游戏 ${active!.gameVersion}`;
		install.disabled = true;
		return;
	}
	if (active && active.releaseId === target!.releaseId) {
		status.textContent = "完整安装已就绪，可以离线游玩";
		detail.textContent = `游戏 ${active!.gameVersion}`;
		install.textContent = "检查更新";
		progress.value = 100;
	} else {
		status.textContent = active ? "发现游戏更新，可以下载新版本" : "准备安装完整游戏";
		detail.textContent = `游戏 ${target!.gameVersion} · 全量内容 ${mb(target!.totalBytes)}`;
		install.textContent = active ? "继续下载 / 更新" : "完整下载";
	}
}
async function start(repairMissing: boolean) {
	if (running) return;
	try {
		await check(true);
		if (maintained || !target) return;
		if (!repairMissing && active?.releaseId === target.releaseId) return;
		const persistent = await navigator.storage?.persist?.().catch(() => false);
		if (!persistent) detail.textContent = "浏览器未授予持久存储，请保留足够空间和本站数据";
		running = true;
		install.disabled = play.disabled = repair.disabled = true;
		pause.hidden = false;
		worker.postMessage({ type: "install", manifest: target });
	} catch (error) {
		status.textContent = String(error instanceof Error ? error.message : error);
		install.disabled = false;
	}
}
invitation.onsubmit = async event => {
	event.preventDefault();
	const input = document.querySelector<HTMLInputElement>("#invite-code")!;
	const button = invitation.querySelector<HTMLButtonElement>("button")!;
	button.disabled = true;
	try {
		const response = await fetch("/__pwa/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: input.value.trim() }) });
		if (!response.ok) throw new Error((await response.json()).error || "邀请码验证失败");
		input.value = "";
		await check(true);
	} catch (error) {
		status.textContent = String(error instanceof Error ? error.message : error);
	} finally { button.disabled = false; }
};
install.onclick = () => start(false);
repair.onclick = () => start(true);
pause.onclick = () => worker.postMessage({ type: "cancel" });
play.onclick = () => {
	if (play.disabled || !active) return;
	status.textContent = "正在进入游戏…";
	// The navigation handler in the Service Worker pins the new game window.
	location.href = `/index.html?release=${encodeURIComponent(active.releaseId)}`;
};
let addEvent: any;
window.addEventListener("beforeinstallprompt", (event: any) => {
	event.preventDefault();
	addEvent = event;
	document.querySelector<HTMLButtonElement>("#add")!.hidden = false;
});
document.querySelector<HTMLButtonElement>("#add")!.onclick = async () => {
	await addEvent?.prompt();
};
document.querySelector("#lobby")!.textContent = `联机大厅：${__LOBBY_URL__}`;
document.addEventListener("visibilitychange", () => {
	if (!document.hidden && !running)
		check().catch(error => {
			status.textContent = String(error);
		});
});
check().catch(error => {
	status.textContent = String(error instanceof Error ? error.message : error);
	install.disabled = false;
});
