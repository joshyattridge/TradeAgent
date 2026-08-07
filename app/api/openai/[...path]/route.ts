import { NextRequest } from "next/server";

export const runtime = "nodejs";

const OPENAI_ORIGIN = "https://api.openai.com";

function targetUrl(pathSegments: string[], search: string) {
  const path = pathSegments.map(encodeURIComponent).join("/");
  return `${OPENAI_ORIGIN}/${path}${search}`;
}

async function proxy(req: NextRequest, pathSegments: string[]) {
  if (!pathSegments.length) {
    return Response.json(
      { error: "Missing OpenAI path. Use /api/openai/v1/..." },
      { status: 400 },
    );
  }

  const url = targetUrl(pathSegments, req.nextUrl.search);
  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const init: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Upstream fetch failed";
    return Response.json(
      { error: "OpenAI proxy failed", reply: detail },
      { status: 502 },
    );
  }

  const outHeaders = new Headers();
  const passThrough = [
    "content-type",
    "cache-control",
    "x-request-id",
    "openai-organization",
    "openai-processing-ms",
    "openai-version",
  ];
  for (const name of passThrough) {
    const value = upstream.headers.get(name);
    if (value) outHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
