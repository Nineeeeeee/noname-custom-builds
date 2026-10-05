import ts from "typescript";
import * as sfc from "@vue/compiler-sfc";
import dedent from "dedent";
import { compile } from "./ts-compiler";

console.log(`ts loaded`, ts.version);
console.log(`sfc loaded`, sfc.version);
sfc.registerTS(() => ts);

export interface RequestContext {
	event: FetchEvent;
	request: Request;
	url: URL;
	importMap?: Record<string, string>;
	readSource?: (url: string, init?: RequestInit) => Promise<Response>;
}

function getResponse(data: string, type: string = "text/javascript") {
	return new Response(new Blob([data], { type }), {
		status: 200,
		statusText: "OK",
		headers: new Headers({
			"Content-Type": type,
		}),
	});
}

export interface BaseStrategy {
	match(ctx: RequestContext): boolean;
	process(ctx: RequestContext): Promise<Response>;
}

abstract class CompileStrategy implements BaseStrategy {
	abstract match(ctx: RequestContext): boolean;
	abstract transform(ctx: RequestContext, text: string): Promise<Response>;

	// 默认行为：请求源文件，再走 transform
	async process(ctx: RequestContext): Promise<Response> {
		const response = await (ctx.readSource || fetch)(ctx.request.url.replace(/\?.*/, ""), {
			method: ctx.request.method,
			// mode: "no-cors",
			headers: new Headers({ "Content-Type": "text/plain" }),
		});

		if (!response.ok) return response;

		const text = await response.text();

		try {
			console.log("正在编译", decodeURI(ctx.request.url));
			const result = await this.transform(ctx, text);
			console.log(decodeURI(ctx.request.url), "编译成功");
			return result;
		} catch (e) {
			console.error(decodeURI(ctx.request.url), "编译失败: ", e);
			return Response.error();
		}
	}
}

// /**
//  * 将nodejs的模块编译为js module模块，是在html中使用了如下代码:
//  * ```js
//  * const builtinModules = require("module").builtinModules;
//  * if (Array.isArray(builtinModules)) {
//  * 	const importMap = {
//  * 		imports: {},
//  * 	};
//  * 	for (const module of builtinModules) {
//  * 		importMap.imports[module] = importMap.imports[`node:${module}`] =
//  * 			`./noname-builtinModules/${module}`;
//  * 	}
//  * 	const im = document.createElement("script");
//  * 	im.type = "importmap";
//  * 	im.textContent = JSON.stringify(importMap);
//  * 	document.currentScript.after(im);
//  * }
//  * ```
//  */
// export class BuiltinModuleStrategy implements BaseStrategy {
// 	match(ctx: RequestContext): boolean {
// 		return ctx.url.pathname.startsWith("/noname-builtinModules/");
// 	}
// 	async process(ctx: RequestContext): Promise<Response> {
// 		const moduleName = ctx.request.url.replace(location.origin + "/noname-builtinModules/", "");
// 		return getResponse(`const module = require('${moduleName}');\nexport default module;`);
// 	}
// }

/**
 * 返回资源的原始内容字符串
 * ```js
 * import string from 'url?raw';
 * ```
 */
export class RawResourceStrategy extends CompileStrategy {
	match(ctx: RequestContext): boolean {
		return ctx.url.searchParams.has("raw");
	}
	async transform(ctx: RequestContext, text: string): Promise<Response> {
		return getResponse(`export default ${JSON.stringify(text)}`);
	}
}

/**
 * 返回一个 Web Worker 或 Shared Worker 构造函数
 * ```js
 * import myWorker from 'url?worker';
 * new myWorker();
 *
 * import myWorker2 from 'url?sharedworker';
 * new myWorker2();
 *
 * import myWorker3 from 'url?worker&module';
 * new myWorker3();
 *
 * import myWorker4 from 'url?sharedworker&module';
 * new myWorker4();
 * ```
 */
export class WorkerResourceStrategy extends CompileStrategy {
	match(ctx: RequestContext): boolean {
		return ctx.url.searchParams.has("worker") || ctx.url.searchParams.has("sharedworker");
	}
	async transform(ctx: RequestContext, text: string): Promise<Response> {
		return getResponse(dedent`
			const url = new URL(import.meta.url);
			url.searchParams.delete("worker");
			url.searchParams.delete("sharedworker");
			export default class extends ${ctx.url.searchParams.has("worker") ? "Worker" : "SharedWorker"} {
				constructor() {
					super(url.toString(), { type: url.searchParams.has("module") ? "module" : "classic" });
				}
			};
		`);
	}
}

/**
 * 返回资源的 URL 而不是文件内容
 * ```js
 * import logoUrl from 'logo.png?url';
 * ```
 */
export class UrlResourceStrategy extends CompileStrategy {
	match(ctx: RequestContext): boolean {
		return ctx.url.searchParams.has("url");
	}
	async transform(ctx: RequestContext, text: string): Promise<Response> {
		// TODO: 返回资源 URL 字符串
		return getResponse(`
			const url = new URL(import.meta.url);
			url.searchParams.delete("url");
			export default url.toString();
		`);
	}
}

export class JSONStrategy extends CompileStrategy {
	match(ctx: RequestContext): boolean {
		// 只处理import关键字发起的请求
		return ctx.url.pathname.endsWith(".json") && ctx.request.destination === "script";
	}
	async transform(ctx: RequestContext, text: string): Promise<Response> {
		// 兼容import with
		if (ctx.request.headers.get("accept")?.includes("application/json")) {
			return getResponse(text, "application/json");
		}
		return getResponse(`export default ${text}`);
	}
}

export class TSStrategy extends CompileStrategy {
	allowJs: boolean = false;
	constructor({ allowJs = false }) {
		super();
		this.allowJs = allowJs;
	}
	match(ctx: RequestContext): boolean {
		if (this.allowJs && ctx.url.pathname.endsWith(".js")) return true;
		if (!ctx.url.pathname.endsWith(".ts")) return false;
		if (ctx.url.pathname.endsWith(".d.ts")) return false;
		if (ctx.request.headers.get("accept")?.includes("video/mp2t")) return false;
		return true;
	}
	async transform(ctx: RequestContext, text: string): Promise<Response> {
		return getResponse(await compile(text, ctx.request.url, ctx.importMap));
	}
}

export class CSSStrategy extends CompileStrategy {
	match(ctx: RequestContext): boolean {
		// 只处理import关键字发起的请求
		return ctx.url.pathname.endsWith(".css") && ctx.request.destination === "script";
	}
	async transform(ctx: RequestContext, text: string): Promise<Response> {
		// 兼容import with
		if (ctx.request.headers.get("accept")?.includes("text/css")) {
			return getResponse(text, "text/css");
		} else {
			const id = Array.from(new TextEncoder().encode(ctx.url.pathname))
				.reduce((a, b) => (a * 31 + b) >>> 0, 0)
				.toString(16);
			const scopeId = `data-v-${id}`;
			return getResponse(dedent`
				const style = document.createElement('style');
				style.setAttribute('type', 'text/css');
				style.setAttribute('data-vue-dev-id', \`${scopeId}\`);
				style.textContent = ${JSON.stringify(text)};
				document.head.appendChild(style);
			`);
		}
	}
}

export class VueSFCStrategy extends CompileStrategy {
	cache = new Map<string, string>();
	match(ctx: RequestContext): boolean {
		return ctx.url.pathname.endsWith(".vue");
	}
	async process(ctx: RequestContext): Promise<Response> {
		if (ctx.url.searchParams.has("type") && !this.cache.has(ctx.request.url)) {
			const parent = new URL(ctx.url);
			parent.searchParams.delete("type");
			await super.process({ ...ctx, url: parent, request: new Request(parent) });
		}
		if (this.cache.has(ctx.request.url)) {
			return getResponse(this.cache.get(ctx.request.url)!);
		}
		return super.process(ctx);
	}
	async transform(ctx: RequestContext, text: string): Promise<Response> {
		const id = Array.from(new TextEncoder().encode(ctx.url.pathname))
			.reduce((a, b) => (a * 31 + b) >>> 0, 0)
			.toString(16);
		// 后续处理sourceMap合并
		const { descriptor } = sfc.parse(text, { filename: ctx.request.url, sourceMap: true });
		// console.log({ descriptor });
		const url = new URL(ctx.request.url);

		return getResponse([...(await this.compileScript(url, descriptor, id, ctx.importMap)), ...this.compileTemplate(url, descriptor, id), ...this.compileStyle(url, descriptor, id)].join("\n"));
	}
	async compileScript(url: URL, descriptor: sfc.SFCDescriptor, id: string, importMap?: Record<string, string>): Promise<string[]> {
		const scopeId = `data-v-${id}`;
		const hasScoped = descriptor.styles.some(s => s.scoped);

		// 编译 script，因为可能有 script setup，还要进行 css 变量注入
		if (!descriptor.script && !descriptor.scriptSetup) {
			const params = new URLSearchParams(url.search);
			params.append("type", "script");
			this.cache.set(`${url.origin}${url.pathname}?${params}`, "export const __sfc_main__ = {};");
			return [`import { __sfc_main__ } from ${JSON.stringify(url.origin + url.pathname + "?" + params)}`, `__sfc_main__.__scopeId = ${JSON.stringify(scopeId)}`];
		}
		const script = sfc.compileScript(descriptor, {
			id: scopeId,
			inlineTemplate: true,
			templateOptions: {
				scoped: hasScoped,
				compilerOptions: {
					scopeId: hasScoped ? scopeId : undefined,
				},
			},
		});

		//缓存后续的子请求
		const scriptSearchParams = new URLSearchParams(url.search.slice(1));
		scriptSearchParams.append("type", "script");
		this.cache.set(
			`${url.origin}${url.pathname}?${scriptSearchParams.toString()}`,
			// 重写 default
			sfc.rewriteDefault(script.attrs && (await compile(script.content, `${url.origin}${url.pathname}?${scriptSearchParams.toString()}`, importMap)), "__sfc_main__").replace(`const __sfc_main__`, `export const __sfc_main__`)
		);
		return [`import { __sfc_main__ } from '${url.origin + url.pathname + "?" + scriptSearchParams.toString()}'`, `__sfc_main__.__scopeId = '${scopeId}'`];
	}
	compileTemplate(url: URL, descriptor: sfc.SFCDescriptor, id: string): string[] {
		const scopeId = `data-v-${id}`;
		const hasScoped = descriptor.styles.some(s => s.scoped);

		//缓存后续的子请求
		const templateSearchParams = new URLSearchParams(url.search.slice(1));
		templateSearchParams.append("type", "template");
		this.cache.set(
			`${url.origin}${url.pathname}?${templateSearchParams.toString()}`,
			// 编译模板，转换成 render 函数
			sfc.compileTemplate({
				source: descriptor.template ? descriptor.template.content : "",
				filename: url.href, // 用于错误提示
				id: scopeId,
				scoped: hasScoped,
				compilerOptions: {
					scopeId: hasScoped ? scopeId : undefined,
				},
			}).code
			// .replace(`function render(_ctx, _cache) {`, str => str + 'console.log(_ctx);')
		);

		return [`import { render } from '${url.origin + url.pathname + "?" + templateSearchParams.toString()}'`, `__sfc_main__.render = render;`, `export default __sfc_main__;`];
	}
	compileStyle(url: URL, descriptor: sfc.SFCDescriptor, id: string): string[] {
		// 一个 Vue 文件可能有多个 style 标签
		let styleIndex = 0;
		const result: string[] = [];
		for (const styleBlock of descriptor.styles) {
			const styleCode = sfc.compileStyle({
				source: styleBlock.content,
				id,
				filename: url.href,
				scoped: styleBlock.scoped,
			});
			const varName = `el${styleIndex}`;
			const styleDOM = `let ${varName} = document.createElement('style');\n${varName}.textContent = ${JSON.stringify(styleCode.code)};\ndocument.head.append(${varName});`;
			styleIndex++;
			result.push(styleDOM);
		}
		return result;
	}
}
