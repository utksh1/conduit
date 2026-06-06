#!/usr/bin/env node

const assert = require("assert");
const app = require("./server");

const { extractToolCalls, buildNormalizedToolCall, shouldTryEarlyToolExtraction } = app._internals;
const allowed = new Set(["glob", "grep", "read", "bash"]);

{
  const text = `<tool_call>
{"name":"file_search.msearch","arguments":{"queries":["list all files"]}}
</tool_call>`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "glob");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { pattern: "**/*" });
}

{
  const text = `<file_search.msearch>{"queries":["*.js"],"path":"/tmp"}</file_search.msearch>`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "glob");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), {
    pattern: "*.js",
    path: "/tmp",
  });
}

{
  const { toolCalls } = extractToolCalls(
    `<tool_call>{"name":"file_search.msearch","arguments":{"queries":["TODO"]}}</tool_call>`,
    new Set(["grep"])
  );
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "grep");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { pattern: "TODO" });
}

{
  const text = `{"queries":[""], "source_filter": ["file_library"], "intent": "nav"}`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "glob");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { pattern: "**/*" });
}

{
  const tc = buildNormalizedToolCall(
    "call_direct_file_search",
    "file_search.msearch",
    `{"queries":[""],"source_filter":["file_library"],"intent":"nav"}`,
    allowed
  );
  assert.strictEqual(tc.function.name, "glob");
  assert.deepStrictEqual(JSON.parse(tc.function.arguments), { pattern: "**/*" });
}

{
  const tc = buildNormalizedToolCall(
    "call_direct_file_search_path",
    "file_search.msearch",
    { queries: ["*.ts"], path: "/tmp/project" },
    allowed
  );
  assert.strictEqual(tc.function.name, "glob");
  assert.deepStrictEqual(JSON.parse(tc.function.arguments), {
    pattern: "*.ts",
    path: "/tmp/project",
  });
}

{
  const text = `I’ll list the workspace files from /Users/Utkarsh/Desktop/Projects/SecuScan and return the paths clearly.`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "glob");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), {
    pattern: "**/*",
    path: "/Users/Utkarsh/Desktop/Projects/SecuScan",
  });
}

{
  const text = `<tool_call>{"name":"container.exec","arguments":{"cmd":"ls -la","workdir":"/Users/Utkarsh/Desktop/Projects/SecuScan"}}</tool_call>`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "bash");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), {
    command: "cd /Users/Utkarsh/Desktop/Projects/SecuScan && ls -la",
  });
}

{
  const text = `functions.exec_command({"cmd":"pwd"})`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "bash");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { command: "pwd" });
}

{
  assert.strictEqual(
    shouldTryEarlyToolExtraction(`<tool_call>{"name":"bash","arguments":{"command":"pwd"}}</tool_call>`),
    true
  );
  assert.strictEqual(
    shouldTryEarlyToolExtraction(`I’ll list the workspace files from /tmp and return the paths clearly.`),
    false
  );
}

console.log("file_search.msearch alias tests passed");
