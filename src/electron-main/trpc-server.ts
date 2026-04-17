import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import type { AnyRouter } from "@trpc/server";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";

/**
 * Node-based tRPC HTTP server used by the Electron main process. Mirrors the
 * capabilities of `src/bun/trpc-server.ts` (CORS for the Vite dev origin,
 * port-probing when another instance is already listening).
 */

const TRPC_PORT_TRY_MAX = 48;

const corsHeaders: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers":
		"content-type, trpc-accept, x-trpc-source, authorization",
};

export interface TrpcServerHandle {
	port: number;
	close: () => void;
}

export async function startTrpcHttpServer(
	router: AnyRouter,
	preferredPort: number,
): Promise<TrpcServerHandle> {
	const maxPort = Math.min(preferredPort + TRPC_PORT_TRY_MAX, 65535);

	for (let port = preferredPort; port <= maxPort; port++) {
		try {
			const handle = await bindServerOnce(router, port);
			if (handle.port !== preferredPort) {
				console.warn(
					`[tRPC] Port ${preferredPort} in use; bound to ${handle.port}. Renderer gets the URL via webContents.send('trpc_endpoint').`,
				);
			}
			return handle;
		} catch (err) {
			const code = (err as { code?: string })?.code;
			if (code !== "EADDRINUSE") throw err;
		}
	}

	throw new Error(
		`Failed to bind tRPC HTTP server between ports ${preferredPort} and ${maxPort}`,
	);
}

function bindServerOnce(
	router: AnyRouter,
	port: number,
): Promise<TrpcServerHandle> {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			void handleRequest(router, req, res);
		});

		server.once("error", (err) => {
			reject(err);
		});

		server.listen(port, "127.0.0.1", () => {
			const address = server.address() as AddressInfo | null;
			const bound = address?.port ?? port;
			resolve({
				port: bound,
				close: () => server.close(),
			});
		});
	});
}

async function handleRequest(
	router: AnyRouter,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	// CORS preflight — renderer can hit this from a Vite-dev origin.
	if (req.method === "OPTIONS") {
		for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
		res.statusCode = 204;
		res.end();
		return;
	}

	for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);

	// Strip the `/trpc/` prefix so the adapter sees the bare procedure path.
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const prefix = "/trpc";
	if (!url.pathname.startsWith(prefix)) {
		res.statusCode = 404;
		res.end("not found");
		return;
	}
	const path = url.pathname.slice(prefix.length).replace(/^\//, "");

	await nodeHTTPRequestHandler({
		router,
		createContext: () => ({}),
		req,
		res,
		path,
	});
}
