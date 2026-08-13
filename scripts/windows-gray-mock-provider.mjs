import { createServer } from "node:http";

const FIXTURE_MODEL = "localbuddy-windows-gray";
const MAX_REQUEST_BYTES = 1_000_000;

export async function startWindowsGrayMockProvider(expectedApiKey) {
  if (typeof expectedApiKey !== "string" || expectedApiKey.length < 12) {
    throw new Error("Windows gray fixture API key is invalid");
  }

  const state = {
    completionRequests: 0,
    modelRequests: 0,
    cancelledRequests: 0,
    recoveryMode: false,
    recoveryInterruptions: 0,
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${expectedApiKey}`) {
        respondJson(response, 401, { error: "fixture authorization failed" });
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname.endsWith("/models")) {
        state.modelRequests += 1;
        await respondToModelProbe(url.pathname, response);
        return;
      }
      if (request.method === "POST" && url.pathname.endsWith("/chat/completions")) {
        state.completionRequests += 1;
        const body = JSON.parse(await readRequestBody(request));
        if (JSON.stringify(body).includes("WINDOWS_GRAY_CANCEL")) {
          state.cancelledRequests += 1;
          await waitForCancellation(response);
          return;
        }
        if (JSON.stringify(body).includes("WINDOWS_GRAY_RECOVERY")) {
          state.recoveryMode = true;
        }
        const prompt = lastUserPrompt(body);
        if (
          state.recoveryMode
          && state.recoveryInterruptions === 0
          && prompt.includes("Task ID: integrate")
        ) {
          state.recoveryInterruptions += 1;
          await waitForCancellation(response);
          return;
        }
        respondToCompletion(body, response);
        return;
      }
      respondJson(response, 404, { error: "fixture route not found" });
    } catch {
      if (!response.headersSent) {
        respondJson(response, 500, { error: "fixture request failed" });
      } else {
        response.destroy();
      }
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Windows gray fixture did not expose a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolvePromise, reject) => {
        server.close((error) => error === undefined ? resolvePromise() : reject(error));
      });
    },
  };
}

async function respondToModelProbe(pathname, response) {
  if (pathname.includes("/unauthorized/")) {
    respondJson(response, 401, { error: "fixture unauthorized" });
    return;
  }
  if (pathname.includes("/rate-limited/")) {
    respondJson(response, 429, { error: "fixture rate limited" });
    return;
  }
  if (pathname.includes("/server-error/")) {
    respondJson(response, 500, { error: "fixture unavailable" });
    return;
  }
  if (pathname.includes("/disconnect/")) {
    response.destroy();
    return;
  }
  if (pathname.includes("/timeout/")) {
    await new Promise((resolvePromise) => {
      const timeout = setTimeout(() => {
        if (!response.destroyed) respondJson(response, 200, { data: [] });
        resolvePromise();
      }, 15_000);
      response.once("close", () => {
        clearTimeout(timeout);
        resolvePromise();
      });
    });
    return;
  }
  respondJson(response, 200, {
    object: "list",
    data: [{ id: FIXTURE_MODEL, object: "model" }],
  });
}

function respondToCompletion(body, response) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const promptText = lastUserPrompt(body);
  const toolResultIds = new Set(
    messages
      .filter((message) => message?.role === "tool" && typeof message.tool_call_id === "string")
      .map((message) => message.tool_call_id),
  );

  if (body.response_format?.type === "json_object") {
    sendContent(response, JSON.stringify({
      tasks: [{
        id: "inspect-fixture",
        title: "Inspect Windows gray fixture",
        instructions: "Read evidence.txt and report the exact non-sensitive fixture statement.",
      }],
      integration: {
        instructions: "Write the grounded fixture statement to a Markdown artifact.",
        fileName: "windows-gray-report.md",
      },
    }));
    return;
  }

  if (promptText.includes("Task ID: inspect-fixture")) {
    if (!toolResultIds.has("gray-read")) {
      sendToolCall(response, "gray-read", "read_file", { path: "evidence.txt" });
      return;
    }
    sendContent(response, "The local Windows gray fixture confirms an installed-app research run.");
    return;
  }

  if (promptText.includes("Task ID: integrate")) {
    if (!toolResultIds.has("gray-artifact")) {
      sendToolCall(response, "gray-artifact", "write_artifact", {
        fileName: "windows-gray-report.md",
        content: "# Windows gray report\n\nThe local fixture confirms an installed-app research run.\n",
        calculationIds: [],
      });
      return;
    }
    sendContent(response, "The fixture artifact was written and registered.");
    return;
  }

  respondJson(response, 500, { error: "unexpected fixture completion request" });
}

function lastUserPrompt(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = [...messages].reverse().find((message) => message?.role === "user")?.content;
  return typeof prompt === "string" ? prompt : "";
}

function sendContent(response, content) {
  sendStream(response, [{
    model: FIXTURE_MODEL,
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  }, {
    model: FIXTURE_MODEL,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }]);
}

function sendToolCall(response, id, name, input) {
  sendStream(response, [{
    model: FIXTURE_MODEL,
    choices: [{
      index: 0,
      delta: {
        role: "assistant",
        tool_calls: [{
          index: 0,
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        }],
      },
      finish_reason: null,
    }],
  }, {
    model: FIXTURE_MODEL,
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }]);
}

function sendStream(response, chunks) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "close",
  });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end("data: [DONE]\n\n");
}

function respondJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function waitForCancellation(response) {
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      if (!response.destroyed) respondJson(response, 504, { error: "fixture cancellation was not observed" });
      resolvePromise();
    }, 30_000);
    response.once("close", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

function readRequestBody(request) {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
        reject(new Error("fixture request is too large"));
        request.destroy();
      }
    });
    request.once("end", () => resolvePromise(body));
    request.once("error", reject);
  });
}
