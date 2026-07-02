/**
 * Unit test for responsesToChat / chatToResponses namespace mapping.
 * Tests the mapping logic directly without making any HTTP requests.
 */
const app = require('./server.js');
const { responsesToChat, chatToResponses } = app._internals;

// ── Test 1: responsesToChat builds toolNameMap for namespace tools ──
console.log('=== Test 1: responsesToChat namespace flattening ===');
const body = {
  model: 'gpt-5-5',
  instructions: 'You are helpful.',
  input: [
    { type: 'message', role: 'user', content: 'List my repos' }
  ],
  tools: [
    { type: 'function', name: 'exec_command', description: 'Run a command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
    { type: 'custom', name: 'apply_patch', description: 'Edit files.' },
    {
      type: 'namespace',
      name: 'mcp__codex_apps__github',
      description: 'GitHub tools',
      tools: [
        { type: 'function', name: '_list_repositories', description: 'List repos', parameters: { type: 'object', properties: {} } },
        { type: 'function', name: '_create_issue', description: 'Create issue', parameters: { type: 'object', properties: {} } }
      ]
    },
    {
      type: 'namespace',
      name: 'mcp__codex_apps__botmail__agent_email',
      description: 'Botmail',
      tools: [
        { type: 'function', name: 'botmail_agen_2ad84997915f', description: 'Read attachment', parameters: { type: 'object', properties: {} } }
      ]
    }
  ]
};

const result = responsesToChat(body);
const { chatBody, toolNameMap } = result;

// Check that namespace tools are flattened
const toolNames = chatBody.tools.map(t => t.function?.name || t.name).filter(Boolean);
console.log('Flattened tool names sent to OpenAI:', toolNames);

// Check toolNameMap
console.log('toolNameMap entries:');
for (const [key, val] of toolNameMap.entries()) {
  console.log(`  "${key}" → "${val}"`);
}

// Verify the map has the right entries
const checks = [
  ['_list_repositories', 'mcp__codex_apps__github/_list_repositories'],
  ['_create_issue', 'mcp__codex_apps__github/_create_issue'],
  ['botmail_agen_2ad84997915f', 'mcp__codex_apps__botmail__agent_email/botmail_agen_2ad84997915f'],
];

let allPassed = true;
for (const [bare, expected] of checks) {
  const got = toolNameMap.get(bare);
  if (got === expected) {
    console.log(`✅ PASS: "${bare}" → "${expected}"`);
  } else {
    console.log(`❌ FAIL: "${bare}" → expected "${expected}", got "${got}"`);
    allPassed = false;
  }
}

// ── Test 2: chatToResponses remaps tool names ──
console.log('\n=== Test 2: chatToResponses name remapping ===');
const fakeChatJson = {
  choices: [{
    message: {
      content: '',
      tool_calls: [
        {
          id: 'call_abc123',
          type: 'function',
          function: { name: '_list_repositories', arguments: '{"limit":5}' }
        },
        {
          id: 'call_def456',
          type: 'function',
          function: { name: 'exec_command', arguments: '{"cmd":"ls"}' }
        },
        {
          id: 'call_ghi789',
          type: 'function',
          function: { name: 'apply_patch', arguments: '{"patch":"..."}' }
        }
      ]
    },
    finish_reason: 'tool_calls'
  }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
};

const callIdMap = new Map();
const responseBody = chatToResponses(fakeChatJson, 'resp_test123', callIdMap, toolNameMap);

console.log('Output items:');
for (const item of responseBody.output) {
  if (item.type === 'function_call') {
    console.log(`  function_call: name="${item.name}"`);
    if (item.name.includes('/')) {
      console.log(`    ✅ PASS: Has namespace prefix`);
    } else if (item.name === 'exec_command') {
      console.log(`    ✅ PASS: Non-namespaced tool correctly passed through`);
    } else {
      console.log(`    ❌ FAIL: Missing namespace prefix`);
      allPassed = false;
    }
  } else if (item.type === 'apply_patch_call') {
    console.log(`  apply_patch_call: patch="${item.patch?.slice(0, 50)}..."`);
    console.log(`    ✅ PASS: apply_patch correctly mapped to apply_patch_call`);
  }
}

// ── Test 3: History function_call items with namespaced names are stripped ──
console.log('\n=== Test 3: History items with namespace prefix ===');
const bodyWithHistory = {
  model: 'gpt-5-5',
  input: [
    { type: 'message', role: 'user', content: 'List repos' },
    {
      type: 'function_call',
      call_id: 'call_prev1',
      name: 'mcp__codex_apps__github/_list_repositories',
      arguments: '{"limit":10}'
    },
    {
      type: 'function_call_output',
      call_id: 'call_prev1',
      output: '[{"name":"repo1"},{"name":"repo2"}]'
    },
    { type: 'message', role: 'user', content: 'Now create an issue' }
  ],
  tools: []
};

const histResult = responsesToChat(bodyWithHistory);
const histMessages = histResult.chatBody.messages;
// Find the assistant message with tool_calls
const assistantMsg = histMessages.find(m => m.role === 'assistant' && m.tool_calls);
if (assistantMsg) {
  const tcName = assistantMsg.tool_calls[0].function.name;
  console.log(`History tool_call name sent to OpenAI: "${tcName}"`);
  if (tcName.includes('/')) {
    console.log(`❌ FAIL: Slash still present — OpenAI will reject this!`);
    allPassed = false;
  } else {
    console.log(`✅ PASS: Namespace prefix stripped for OpenAI`);
  }
} else {
  console.log('⚠️  No assistant message with tool_calls found (unexpected)');
}

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('🎉 ALL TESTS PASSED');
} else {
  console.log('💥 SOME TESTS FAILED');
}

process.exit(allPassed ? 0 : 1);
