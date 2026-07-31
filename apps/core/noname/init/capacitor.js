//@ts-nocheck

/**
 * 初始化 Capacitor 客户端所需的平台能力。
 *
 * APK 中的游戏资源由 WebViewAssetLoader 以 https://localhost/ 提供，
 * 不存在浏览器开发服务器的 /checkFile 等接口，因此文件读取直接走 fetch。
 */
export default async function capacitorReady({ lib, game }) {
	lib.path = (await import("path-browserify-esm")).default;

	game.export = function (data, name) {
		if (typeof data === "string") {
			data = new Blob([data], { type: "text/plain" });
		}
		const fileName = (name || "noname").replace(/\\|\/|:|\?|"|\*|<|>|\|/g, "-");
		const downloadLink = document.createElement("a");
		downloadLink.download = fileName;
		downloadLink.href = window.URL.createObjectURL(data);
		downloadLink.click();
		window.URL.revokeObjectURL(downloadLink.href);
	};

	game.exit = function () {
		const app = window.Capacitor?.Plugins?.App;
		if (typeof app?.exitApp === "function") {
			void app.exitApp();
		} else {
			window.close();
		}
	};

	game.open = function (url) {
		window.open(url, "_blank");
	};

	const getAssetURL = fileName => {
		const normalized = String(fileName)
			.replaceAll("\\", "/")
			.replace(/^(\.\/|\/)+/, "");
		return new URL(normalized, new URL("./", window.location.href));
	};

	const fetchAsset = async fileName => {
		const response = await fetch(getAssetURL(fileName), { cache: "no-store" });
		if (!response.ok) {
			throw new Error(`无法读取文件 ${fileName}（HTTP ${response.status}）`);
		}
		return response;
	};

	const normalizeAssetDirectory = directory => {
		const url = new URL(String(directory || ""), window.location.href);
		return decodeURIComponent(url.pathname)
			.replaceAll("\\", "/")
			.replace(/^\/+|\/+$/g, "");
	};

	const assetManifest = await fetchAsset("noname-asset-manifest.json").then(response => response.json());

	game.checkFile = function (fileName, callback, onerror) {
		fetchAsset(fileName)
			.then(() => callback?.(1))
			.catch(error => {
				// 文件不存在或 APK 资源不可访问时均按历史接口约定返回 -1。
				callback?.(-1);
				if (!(error instanceof TypeError)) {
					console.debug(error);
				}
			});
	};

	game.readFile = function (fileName, callback, onerror) {
		fetchAsset(fileName)
			.then(response => response.arrayBuffer())
			.then(callback)
			.catch(onerror);
	};

	game.readFileAsText = function (fileName, callback, onerror) {
		fetchAsset(fileName)
			.then(response => response.text())
			.then(callback)
			.catch(onerror);
	};

	game.getFileList = function (directory, callback = () => {}, onerror = () => {}) {
		const normalized = normalizeAssetDirectory(directory);
		const entry = assetManifest[normalized];
		if (!entry) {
			onerror(new Error(`无法读取目录 ${directory}`));
			return;
		}
		callback([...entry.folders], [...entry.files]);
	};
}
