import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const port = {
	client: 8081,
	server: 8089,
};

export default defineConfig({
	appType: "mpa",
	define: { "import.meta.env.NONAME_PWA": JSON.stringify(process.env.NONAME_TARGET === "pwa"), "__LOBBY_URL__": JSON.stringify(process.env.NONAME_LOBBY_URL || "wss://lobby.491528.xyz") },
	root: ".",
	base: "./",
	resolve: {
		alias: {
			"@": "/noname",
			noname: "/noname.js",
		},
	},
	plugins: [vue()],
	server: {
		host: "127.0.0.1",
		port: port.client,
		fs: {
			allow: ["../.."],
		},
		proxy: {
			"/checkFile": "http://127.0.0.1:" + port.server,
			"/checkDir": "http://127.0.0.1:" + port.server,
			"/readFile": "http://127.0.0.1:" + port.server,
			"/readFileAsText": "http://127.0.0.1:" + port.server,
			"/writeFile": "http://127.0.0.1:" + port.server,
			"/removeFile": "http://127.0.0.1:" + port.server,
			"/getFileList": "http://127.0.0.1:" + port.server,
			"/createDir": "http://127.0.0.1:" + port.server,
			"/removeDir": "http://127.0.0.1:" + port.server,
		},
	},
});
