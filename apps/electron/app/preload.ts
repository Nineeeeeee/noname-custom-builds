import { app, getCurrentWindow } from "@electron/remote";
const thisWindow = getCurrentWindow();

console.info("[electron:preload] loaded", {
	href: location.href,
	readyState: document.readyState,
	userAgent: navigator.userAgent,
});

window.addEventListener(
	"error",
	event => {
		if (event instanceof ErrorEvent) {
			console.error("[electron:preload] window error", {
				message: event.message,
				filename: event.filename,
				line: event.lineno,
				column: event.colno,
				error: event.error,
			});
			return;
		}

		const target = event.target as HTMLScriptElement | HTMLLinkElement | null;
		console.error("[electron:preload] resource error", target?.src || target?.href || target);
	},
	true
);

window.addEventListener("unhandledrejection", event => {
	console.error("[electron:preload] unhandled rejection", event.reason);
});

window.addEventListener("DOMContentLoaded", () => {
	console.info("[electron:preload] DOM ready", {
		href: location.href,
		scripts: document.scripts.length,
		serviceWorkerController: navigator.serviceWorker?.controller?.scriptURL ?? null,
	});
});

thisWindow.setAutoHideMenuBar(false);
thisWindow.setMenuBarVisibility(true);

thisWindow.on("leave-full-screen", () => {
	if (!thisWindow.isDestroyed()) {
		thisWindow.webContents.closeDevTools();
	} else {
		app.exit(0);
	}
});
