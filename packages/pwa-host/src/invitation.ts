/** Invitation checks run before any R2 operation. No server-side session store. */
export interface InvitationEnv {
	PWA_INVITE_CODE?: string;
	INVITE_LOGIN_LIMIT: RateLimit;
	INVITE_DOWNLOAD_LIMIT: RateLimit;
}
const cookieName = "__Host-noname_invite";
const lifetime = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
let signing: { secret: string; key: Promise<CryptoKey> } | undefined;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
function key(secret: string) {
	if (signing?.secret !== secret) signing = { secret, key: crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) };
	return signing!.key;
}
function hex(bytes: ArrayBuffer) {
	return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
async function validSession(request: Request, secret: string) {
	const value = request.headers
		.get("Cookie")
		?.split(";")
		.map(s => s.trim())
		.find(s => s.startsWith(cookieName + "="))
		?.slice(cookieName.length + 1);
	const match = value && /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
	if (!match) return false;
	const expires = Number(match[1]),
		now = Math.floor(Date.now() / 1000);
	if (expires <= now || expires > now + lifetime + 60) return false;
	const message = `${new URL(request.url).hostname}|${match[1]}.${match[2]}`;
	const signature = new Uint8Array(match[3].match(/../g)!.map(part => parseInt(part, 16)));
	return crypto.subtle.verify("HMAC", await key(secret), signature, encoder.encode(message));
}
async function readCode(request: Request): Promise<string> {
	if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new Error("JSON required");
	const reader = request.body?.getReader();
	if (!reader) throw new Error("Code required");
	const parts: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			length += next.value.length;
			if (length > 1024) {
				await reader.cancel();
				throw new Error("Body too large");
			}
			parts.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	const body = JSON.parse(new TextDecoder().decode(bytes));
	if (typeof body.code !== "string" || !body.code.length || body.code.length > 256) throw new Error("Code required");
	return body.code;
}
export async function invitationRoute(request: Request, env: InvitationEnv): Promise<Response> {
	const secret = env.PWA_INVITE_CODE;
	if (!secret) return json({ error: "下载入口尚未配置邀请码" }, 503);
	if (request.method === "GET") return json({ authenticated: await validSession(request, secret) });
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const origin = request.headers.get("Origin");
	if ((origin && origin !== new URL(request.url).origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return json({ error: "Forbidden" }, 403);
	if (!(await env.INVITE_LOGIN_LIMIT.limit({ key: "login:" + (request.headers.get("CF-Connecting-IP") || "unknown") })).success) return json({ error: "尝试过于频繁，请稍后重试" }, 429, { "Retry-After": "60" });
	let code: string;
	try {
		code = await readCode(request);
	} catch {
		return json({ error: "请输入有效邀请码" }, 400);
	}
	const supplied = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(code)));
	const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
	let difference = 0;
	for (let i = 0; i < expected.length; i++) difference |= supplied[i] ^ expected[i];
	if (difference) return json({ error: "邀请码不正确" }, 401);
	const expires = Math.floor(Date.now() / 1000) + lifetime;
	const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
	const payload = `${expires}.${nonce}`;
	const signature = hex(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(`${new URL(request.url).hostname}|${payload}`)));
	return json({ authenticated: true }, 200, { "Set-Cookie": `${cookieName}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${lifetime}` });
}
export async function requireInvitation(request: Request, env: InvitationEnv): Promise<Response | null> {
	if (!env.PWA_INVITE_CODE) return json({ error: "下载入口尚未配置邀请码" }, 503);
	if (!(await validSession(request, env.PWA_INVITE_CODE))) return json({ error: "下载和更新需要邀请码", invitationRequired: true }, 401);
	if (!(await env.INVITE_DOWNLOAD_LIMIT.limit({ key: "downloads:" + (request.headers.get("CF-Connecting-IP") || "unknown") })).success) return json({ error: "下载请求过于频繁，请稍后继续" }, 429, { "Retry-After": "60" });
	return null;
}
