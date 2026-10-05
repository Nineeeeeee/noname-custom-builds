/** Multiple ranges are ignored (full 200); invalid single ranges return 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | false {
	if (!header || header.includes(",")) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!match || (!match[1] && !match[2]) || size === 0) return false;
	let start: number, end: number;
	if (!match[1]) {
		const suffix = Number(match[2]);
		if (!suffix || !Number.isSafeInteger(suffix)) return false;
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	}
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return false;
	return { start, end };
}
export async function localResponse(response: Response, request: Request, type: string, size: number): Promise<Response> {
	const headers = new Headers({ "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
	const range = parseRange(request.headers.get("range"), size);
	if (range === false) {
		headers.set("Content-Range", `bytes */${size}`);
		headers.set("Content-Length", "0");
		return new Response(null, { status: 416, headers });
	}
	if (range) {
		headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
		headers.set("Content-Length", String(range.end - range.start + 1));
		return new Response(request.method === "HEAD" ? null : (await response.blob()).slice(range.start, range.end + 1), { status: 206, headers });
	}
	return new Response(request.method === "HEAD" ? null : response.body, { headers });
}
