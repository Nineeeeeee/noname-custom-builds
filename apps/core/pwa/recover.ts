export {};
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;
async function recover() {
	retry.disabled = true;
	status.textContent = "正在更新启动器…";
	try {
		const registration = (await navigator.serviceWorker.getRegistration("/")) || (await navigator.serviceWorker.register("/service-worker.js", { scope: "/" }));
		await registration.update();
		const installing = registration.installing;
		if (installing)
			await new Promise<void>((resolve, reject) => {
				const check = () => {
					if (installing.state === "installed" || installing.state === "activated") {
						installing.removeEventListener("statechange", check);
						resolve();
					} else if (installing.state === "redundant") {
						installing.removeEventListener("statechange", check);
						reject(new Error("启动器下载失败，请重试"));
					}
				};
				installing.addEventListener("statechange", check);
				check();
			});
		const waiting = registration.waiting;
		if (waiting) {
			const activated = await new Promise<boolean>((resolve, reject) => {
				const channel = new MessageChannel();
				const timer = setTimeout(() => {
					channel.port1.close();
					reject(new Error("启动器响应超时，请重试"));
				}, 15000);
				channel.port1.onmessage = event => {
					clearTimeout(timer);
					channel.port1.close();
					if (event.data.error) reject(new Error(event.data.error));
					else resolve(event.data.activated === true);
				};
				waiting.postMessage({ type: "activate" }, [channel.port2]);
			});
			if (!activated) throw new Error("请关闭其他正在运行的游戏窗口，再点重试");
			if (waiting.state !== "activated")
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(() => {
						waiting.removeEventListener("statechange", check);
						reject(new Error("启动器切换超时，请重试"));
					}, 15000);
					const check = () => {
						if (waiting.state === "activated") {
							clearTimeout(timer);
							waiting.removeEventListener("statechange", check);
							resolve();
						}
					};
					waiting.addEventListener("statechange", check);
					check();
				});
		}
		location.replace("/launcher.html");
	} catch (error) {
		status.textContent = `恢复未完成：${error instanceof Error ? error.message : String(error)}`;
		retry.disabled = false;
	}
}
retry.addEventListener("click", recover);
void recover();
