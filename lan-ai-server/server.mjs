import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8090);

const mimeTypes = new Map([
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".mjs", "text/javascript; charset=utf-8"],
	[".css", "text/css; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".webmanifest", "application/manifest+json; charset=utf-8"],
	[".wasm", "application/wasm"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".svg", "image/svg+xml"],
	[".ico", "image/x-icon"],
	[".mp3", "audio/mpeg"],
	[".ogg", "audio/ogg"],
	[".wav", "audio/wav"],
	[".ttf", "font/ttf"],
	[".otf", "font/otf"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
]);

const ok = data => JSON.stringify({ success: true, code: 200, data });
const fail = message => JSON.stringify({ success: false, code: 400, errorMsg: String(message) });

function resolvePublicPath(requestPath) {
	const fullPath = path.resolve(publicDir, `.${requestPath}`);
	if (!fullPath.startsWith(publicDir + path.sep) && fullPath !== publicDir) return null;
	return fullPath;
}

function resolveFileApiPath(relativePath) {
	const normalized = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
	return resolvePublicPath(normalized);
}

async function readJsonBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	if (!chunks.length) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function sendJson(res, handler) {
	try {
		const data = await handler();
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(ok(data));
	} catch (error) {
		res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
		res.end(fail(error?.message || error));
	}
}

async function handleFileApi(req, res, url) {
	if (url.pathname === "/checkFile") {
		await sendJson(res, async () => {
			const fullPath = resolveFileApiPath(url.searchParams.get("fileName") || "");
			if (!fullPath) throw new Error("Invalid path");
			try {
				const info = await stat(fullPath);
				return info.isFile() ? "file" : "directory";
			} catch {
				return {};
			}
		});
		return true;
	}

	if (url.pathname === "/checkDir") {
		await sendJson(res, async () => {
			const fullPath = resolveFileApiPath(url.searchParams.get("dir") || "");
			if (!fullPath) throw new Error("Invalid path");
			try {
				const info = await stat(fullPath);
				return info.isFile() ? "file" : "directory";
			} catch {
				return {};
			}
		});
		return true;
	}

	if (url.pathname === "/readFile" || url.pathname === "/readFileAsText") {
		await sendJson(res, async () => {
			const fullPath = resolveFileApiPath(url.searchParams.get("fileName") || "");
			if (!fullPath) throw new Error("Invalid path");
			const data = await readFile(fullPath);
			return url.pathname === "/readFileAsText" ? data.toString("utf8") : [...new Uint8Array(data)];
		});
		return true;
	}

	if (url.pathname === "/getFileList") {
		await sendJson(res, async () => {
			const fullPath = resolveFileApiPath(url.searchParams.get("dir") || "");
			if (!fullPath) throw new Error("Invalid path");
			const entries = await readdir(fullPath, { withFileTypes: true });
			const folders = [];
			const files = [];
			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
				(entry.isDirectory() ? folders : files).push(entry.name);
			}
			return { folders, files };
		});
		return true;
	}

	if (url.pathname === "/createDir") {
		await sendJson(res, async () => {
			const fullPath = resolveFileApiPath(url.searchParams.get("dir") || "");
			if (!fullPath) throw new Error("Invalid path");
			await mkdir(fullPath, { recursive: true });
			return true;
		});
		return true;
	}

	if (url.pathname === "/removeDir") {
		await sendJson(res, async () => {
			const fullPath = resolveFileApiPath(url.searchParams.get("dir") || "");
			if (!fullPath) throw new Error("Invalid path");
			await rm(fullPath, { recursive: true, force: true });
			return true;
		});
		return true;
	}

	if (url.pathname === "/removeFile") {
		await sendJson(res, async () => {
			const fullPath = resolveFileApiPath(url.searchParams.get("fileName") || "");
			if (!fullPath) throw new Error("Invalid path");
			await unlink(fullPath);
			return true;
		});
		return true;
	}

	if (url.pathname === "/writeFile") {
		await sendJson(res, async () => {
			if (req.method !== "POST") throw new Error("Method Not Allowed");
			const body = await readJsonBody(req);
			const fullPath = resolveFileApiPath(body.path || "");
			if (!fullPath) throw new Error("Invalid path");
			await mkdir(path.dirname(fullPath), { recursive: true });
			await writeFile(fullPath, Buffer.from(body.data || []));
			return true;
		});
		return true;
	}

	return false;
}

function resolveRequestPath(url) {
	let pathname = decodeURIComponent(url.pathname);
	if (pathname === "/") pathname = "/index.html";

	return resolvePublicPath(pathname);
}

const server = createServer(async (req, res) => {
	if (!req.url) {
		res.writeHead(400);
		res.end("Bad Request");
		return;
	}

	const url = new URL(req.url, `http://${host}:${port}`);
	if (await handleFileApi(req, res, url)) return;

	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end("Method Not Allowed");
		return;
	}

	const filePath = resolveRequestPath(url);
	if (!filePath) {
		res.writeHead(403);
		res.end("Forbidden");
		return;
	}

	try {
		const info = await stat(filePath);
		if (!info.isFile()) throw new Error("Not a file");

		const ext = path.extname(filePath).toLowerCase();
		res.writeHead(200, {
			"Content-Type": mimeTypes.get(ext) || "application/octet-stream",
			"Content-Length": info.size,
			"Cache-Control": "no-cache",
		});
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		createReadStream(filePath).pipe(res);
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("Not Found");
	}
});

server.listen(port, host, () => {
	console.log(`Noname LAN server running at http://127.0.0.1:${port}/`);
	console.log(`Open http://<this-computer-lan-ip>:${port}/ from another device on the same LAN.`);
});
