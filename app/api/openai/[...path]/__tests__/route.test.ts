import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

import {
  DELETE,
  GET,
  PATCH,
  POST,
  PUT,
} from "../route";

function makeReq(
  method: string,
  path: string,
  opts: { body?: string; auth?: string } = {},
) {
  return new NextRequest(`http://localhost/api/openai/${path}`, {
    method,
    body: opts.body,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.auth ? { Authorization: opts.auth } : {}),
      Accept: "application/json",
    },
  });
}

describe("/api/openai proxy", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns 400 when path is empty", async () => {
    const res = await POST(makeReq("POST", "v1/responses"), {
      params: Promise.resolve({ path: [] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Missing") });
  });

  it("forwards POST body and auth to OpenAI", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-request-id": "r1" },
      }),
    );

    const res = await POST(
      makeReq("POST", "v1/responses", {
        body: JSON.stringify({ model: "gpt-test" }),
        auth: "Bearer sk-test",
      }),
      { params: Promise.resolve({ path: ["v1", "responses"] }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-request-id")).toBe("r1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("authorization")).toBe("Bearer sk-test");
  });

  it("forwards GET and other methods", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await GET(makeReq("GET", "v1/models"), {
      params: Promise.resolve({ path: ["v1", "models"] }),
    });
    expect(mockFetch.mock.calls.at(-1)?.[0]).toBe(
      "https://api.openai.com/v1/models",
    );

    await PUT(makeReq("PUT", "v1/x", { body: "{}" }), {
      params: Promise.resolve({ path: ["v1", "x"] }),
    });
    await PATCH(makeReq("PATCH", "v1/x", { body: "{}" }), {
      params: Promise.resolve({ path: ["v1", "x"] }),
    });
    await DELETE(makeReq("DELETE", "v1/x"), {
      params: Promise.resolve({ path: ["v1", "x"] }),
    });
    expect(mockFetch).toHaveBeenCalled();
  });

  it("treats a missing path param as empty", async () => {
    const ctx = {
      params: Promise.resolve({ path: undefined as unknown as string[] }),
    };
    expect((await GET(makeReq("GET", "v1/models"), ctx)).status).toBe(400);
    expect((await POST(makeReq("POST", "v1/x", { body: "{}" }), ctx)).status).toBe(
      400,
    );
    expect((await PUT(makeReq("PUT", "v1/x", { body: "{}" }), ctx)).status).toBe(
      400,
    );
    expect(
      (await PATCH(makeReq("PATCH", "v1/x", { body: "{}" }), ctx)).status,
    ).toBe(400);
    expect((await DELETE(makeReq("DELETE", "v1/x"), ctx)).status).toBe(400);
  });

  it("omits accept when the client did not send one", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const req = new NextRequest("http://localhost/api/openai/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer sk" },
    });
    await GET(req, { params: Promise.resolve({ path: ["v1", "models"] }) });
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("accept")).toBeNull();
  });

  it("returns 502 when upstream fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("dns fail"));
    const res = await POST(makeReq("POST", "v1/responses", { body: "{}" }), {
      params: Promise.resolve({ path: ["v1", "responses"] }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "OpenAI proxy failed",
      reply: "dns fail",
    });
  });

  it("handles non-Error upstream failures", async () => {
    mockFetch.mockRejectedValueOnce("boom");
    const res = await POST(makeReq("POST", "v1/chat/completions", { body: "{}" }), {
      params: Promise.resolve({ path: ["v1", "chat", "completions"] }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      reply: "Upstream fetch failed",
    });
  });
});
