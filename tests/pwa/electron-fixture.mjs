// Independent Linux Electron protocol fixture; no game server or existing profile.
import { app, BrowserWindow } from "electron";
app.whenReady().then(async () => {
	const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
	await window.loadURL("data:text/html,<title>Noname Electron protocol fixture</title>");
});
app.on("window-all-closed", () => app.quit());
