// ==========================================================================
// STATE MANAGEMENT & CONSTANTS
// ==========================================================================
let conversations = [];
let activeConversationId = null;
const STORAGE_KEY = 'chatgpt_proxy_conversations';
const ACTIVE_CONV_KEY = 'chatgpt_proxy_active_id';

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const welcomeScreen = document.getElementById('welcomeScreen');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const historyList = document.getElementById('historyList');
const clearChatBtn = document.getElementById('clearChatBtn');
const streamToggle = document.getElementById('streamToggle');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');
const chatTitle = document.getElementById('chatTitle');
const modelSelect = document.getElementById('modelSelect');
const modelSelectMobile = document.getElementById('modelSelectMobile');
let currentModel = localStorage.getItem('chatgpt_proxy_model') || 'gpt-5-5';

// ==========================================================================
// INITIALIZATION
// ==========================================================================
function init() {
  console.log('[ChatGPT UI] Initializing...');
  loadFromLocalStorage();
  
  // Sync select values with current state
  if (modelSelect) modelSelect.value = currentModel;
  if (modelSelectMobile) modelSelectMobile.value = currentModel;
  
  setupEventListeners();
  
  if (conversations.length === 0) {
    startNewConversation();
  } else {
    // Restore last active conversation
    const savedActiveId = localStorage.getItem(ACTIVE_CONV_KEY);
    const exists = conversations.some(c => c.id === savedActiveId);
    if (exists) {
      selectConversation(savedActiveId);
    } else {
      selectConversation(conversations[0].id);
    }
  }
  
  adjustTextareaHeight();
  console.log('[ChatGPT UI] Ready.');
}

// Run init immediately if DOM is already parsed, otherwise wait for it
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ==========================================================================
// LOCAL STORAGE PERSISTENCE
// ==========================================================================
function loadFromLocalStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    conversations = data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Error loading conversations from localStorage:', e);
    conversations = [];
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    if (activeConversationId) {
      localStorage.setItem(ACTIVE_CONV_KEY, activeConversationId);
    } else {
      localStorage.removeItem(ACTIVE_CONV_KEY);
    }
  } catch (e) {
    console.error('Error saving conversations to localStorage:', e);
  }
}

// ==========================================================================
// CONVERSATION CONTROL
// ==========================================================================
function startNewConversation() {
  const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const newConv = {
    id: newId,
    title: 'New Conversation',
    messages: [],
    createdAt: new Date().toISOString()
  };
  
  conversations.unshift(newConv);
  activeConversationId = newId;
  saveToLocalStorage();
  
  renderSidebar();
  loadConversation(newId);
  
  // Auto focus input
  setTimeout(() => chatInput.focus(), 50);
}

function selectConversation(id) {
  activeConversationId = id;
  saveToLocalStorage();
  renderSidebar();
  loadConversation(id);
  
  // Auto focus input
  setTimeout(() => chatInput.focus(), 50);
}

function deleteConversation(id, event) {
  if (event) event.stopPropagation();
  
  const index = conversations.findIndex(c => c.id === id);
  if (index === -1) return;
  
  conversations.splice(index, 1);
  
  if (activeConversationId === id) {
    activeConversationId = conversations.length > 0 ? conversations[0].id : null;
  }
  
  saveToLocalStorage();
  renderSidebar();
  
  if (activeConversationId) {
    loadConversation(activeConversationId);
  } else {
    startNewConversation();
  }
}

function clearCurrentChat() {
  const active = conversations.find(c => c.id === activeConversationId);
  if (!active) return;
  
  active.messages = [];
  active.title = 'New Conversation';
  saveToLocalStorage();
  
  renderSidebar();
  loadConversation(activeConversationId);
}

// ==========================================================================
// SIDEBAR RENDERER
// ==========================================================================
function renderSidebar() {
  historyList.innerHTML = '';
  
  if (conversations.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No conversations yet</div>';
    return;
  }
  
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = `history-item ${conv.id === activeConversationId ? 'active' : ''}`;
    item.setAttribute('data-id', conv.id);
    
    // Add Click listener to switch chat
    item.addEventListener('click', () => selectConversation(conv.id));
    
    const details = document.createElement('div');
    details.className = 'history-item-details';
    
    // Chat Bubble SVG Icon
    details.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="history-item-title">${escapeHTML(conv.title)}</span>
    `;
    
    // Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'history-item-delete';
    deleteBtn.title = 'Delete Chat';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    deleteBtn.addEventListener('click', (e) => deleteConversation(conv.id, e));
    
    item.appendChild(details);
    item.appendChild(deleteBtn);
    historyList.appendChild(item);
  });
}

// ==========================================================================
// CHAT CONTAINER LOADER
// ==========================================================================
function loadConversation(id) {
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  
  // Clear feed
  chatMessages.innerHTML = '';
  chatTitle.textContent = conv.title;
  
  if (conv.messages.length === 0) {
    // Show Welcome screen
    chatMessages.appendChild(welcomeScreen);
    welcomeScreen.style.display = 'flex';
  } else {
    // Hide Welcome screen
    welcomeScreen.style.display = 'none';
    
    // Render messages
    conv.messages.forEach(msg => {
      appendMessageToUI(msg.role, msg.content, msg.durationMs);
    });
    
    scrollToBottom();
  }
}

// ==========================================================================
// MESSAGE UI HELPERS
// ==========================================================================
function appendMessageToUI(role, content, durationMs) {
  // If welcome screen is visible, hide it
  if (welcomeScreen.parentNode === chatMessages && chatMessages.children.length === 1) {
    welcomeScreen.style.display = 'none';
    chatMessages.removeChild(welcomeScreen);
  }
  
  const messageRow = document.createElement('div');
  messageRow.className = `message-row ${role}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  
  if (role === 'user') {
    // User Icon (Person outline)
    avatar.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
    `;
  } else {
    // Bot Icon (CPU/Sparkle)
    avatar.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        <line x1="6" y1="6" x2="6.01" y2="6"></line>
        <line x1="6" y1="18" x2="6.01" y2="18"></line>
      </svg>
    `;
  }
  
  const bubbleContainer = document.createElement('div');
  bubbleContainer.className = 'bubble-container';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  
  if (role === 'assistant') {
    bubble.innerHTML = formatMessageText(content);
  } else {
    // Render text with basic HTML escaped and paragraph breaks for User
    bubble.innerHTML = `<div class="md-p">${escapeHTML(content).replace(/\n/g, '<br>')}</div>`;
  }
  
  bubbleContainer.appendChild(bubble);

  if (role === 'assistant' && durationMs !== undefined) {
    const meta = document.createElement('div');
    meta.className = 'message-metadata';
    const seconds = (durationMs / 1000).toFixed(2);
    meta.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="meta-icon">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span>Response Time: ${seconds}s</span>
    `;
    bubbleContainer.appendChild(meta);
  }

  // Assemble
  if (role === 'assistant') {
    messageRow.appendChild(avatar);
    messageRow.appendChild(bubbleContainer);
  } else {
    messageRow.appendChild(bubbleContainer);
    messageRow.appendChild(avatar);
  }
  
  chatMessages.appendChild(messageRow);
  attachCodeCopyEvents(bubble);
  return bubble;
}

function showTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row assistant typing-indicator-row';
  row.id = 'typingIndicator';
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
      <line x1="6" y1="6" x2="6.01" y2="6"></line>
      <line x1="6" y1="18" x2="6.01" y2="18"></line>
    </svg>
  `;
  
  const bubble = document.createElement('div');
  bubble.className = 'typing-bubble';
  bubble.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  `;
  
  row.appendChild(avatar);
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  scrollToBottom();
}

function removeTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.remove();
  }
}

function scrollToBottom() {
  const container = document.querySelector('.chat-scroll-container');
  if (container) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  }
}

// ==========================================================================
// EVENT LISTENERS & UI INTERACTION
// ==========================================================================
function setupEventListeners() {
  // New Chat Click
  newChatBtn.addEventListener('click', startNewConversation);
  
  // Clear Current Chat
  clearChatBtn.addEventListener('click', clearCurrentChat);
  
  // Input Typing / Auto grow / Update send button state
  const handleInputChange = () => {
    adjustTextareaHeight();
    sendBtn.disabled = chatInput.value.trim() === '';
  };
  chatInput.addEventListener('input', handleInputChange);
  chatInput.addEventListener('keyup', handleInputChange);
  chatInput.addEventListener('change', handleInputChange);
  
  // Send Button Click
  sendBtn.addEventListener('click', sendMessage);
  
  // Enter key submits (Shift+Enter adds a newline)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Sidebar Toggle (Mobile)
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  
  // Click workspace closes sidebar in mobile
  document.querySelector('.chat-workspace').addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && e.target !== sidebarToggle && !sidebarToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    }
  });
  
  // Suggested Prompt Clicks
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-prompt');
      chatInput.value = prompt;
      adjustTextareaHeight();
      sendBtn.disabled = false;
      sendMessage();
    });
  });

  // Model Select Change
  const handleModelChange = (e) => {
    currentModel = e.target.value;
    localStorage.setItem('chatgpt_proxy_model', currentModel);
    if (modelSelect) modelSelect.value = currentModel;
    if (modelSelectMobile) modelSelectMobile.value = currentModel;
  };
  if (modelSelect) modelSelect.addEventListener('change', handleModelChange);
  if (modelSelectMobile) modelSelectMobile.addEventListener('change', handleModelChange);
}

function adjustTextareaHeight() {
  chatInput.style.height = 'auto';
  // set to scrollHeight, clamped by max-height in CSS
  chatInput.style.height = (chatInput.scrollHeight) + 'px';
}

// ==========================================================================
// SEND & STREAM CONTROLLER (API BRIDGE)
// ==========================================================================
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  
  let active = conversations.find(c => c.id === activeConversationId);
  if (!active) {
    if (conversations.length > 0) {
      activeConversationId = conversations[0].id;
      active = conversations[0];
    } else {
      startNewConversation();
      active = conversations.find(c => c.id === activeConversationId);
    }
  }
  if (!active) return;
  
  // Clear text input
  chatInput.value = '';
  adjustTextareaHeight();
  sendBtn.disabled = true;
  
  // 1. Update Title if it was default
  if (active.messages.length === 0) {
    let cleanTitle = text.length > 28 ? text.slice(0, 25) + '...' : text;
    active.title = cleanTitle;
    chatTitle.textContent = cleanTitle;
    renderSidebar();
  }
  
  // 2. Append User message
  active.messages.push({ role: 'user', content: text });
  saveToLocalStorage();
  
  appendMessageToUI('user', text);
  scrollToBottom();
  
  // 3. Show typing loader
  showTypingIndicator();
  
  const stream = streamToggle.checked;
  const startTime = Date.now();
  
  try {
    const payload = {
      model: currentModel,
      messages: active.messages,
      stream: stream
    };
    
    const response = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    removeTypingIndicator();
    
    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `Proxy Error (${response.status})`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error?.message || errMsg;
      } catch(e) {}
      
      appendMessageToUI('assistant', `⚠️ **Error: ${errMsg}**\n\nPlease check that your session token is active and the backend server is running.`);
      return;
    }
    
    if (stream) {
      // Create Assistant bubble empty placeholder
      const bubble = appendMessageToUI('assistant', '');
      
      // We will create the metadata duration element dynamically below the bubble container
      const bubbleContainer = bubble.closest('.bubble-container');
      let metaElement = null;
      
      let fullContent = '';
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep last potentially incomplete line
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          if (trimmed === 'data: [DONE]') {
            break;
          }
          
          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.slice(6);
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                bubble.innerHTML = formatMessageText(fullContent);
                attachCodeCopyEvents(bubble);
                
                // Real-time updating latency badge
                const elapsedMs = Date.now() - startTime;
                const seconds = (elapsedMs / 1000).toFixed(2);
                if (bubbleContainer) {
                  if (!metaElement) {
                    metaElement = document.createElement('div');
                    metaElement.className = 'message-metadata';
                    bubbleContainer.appendChild(metaElement);
                  }
                  metaElement.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="meta-icon">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span>Response Time: ${seconds}s</span>
                  `;
                }
                
                scrollToBottom();
              }
            } catch(e) {
              // Ignore parsing errors of incomplete JSON chunks
            }
          }
        }
      }
      
      const finalDuration = Date.now() - startTime;
      
      // Store full content in history with metadata
      active.messages.push({ role: 'assistant', content: fullContent, durationMs: finalDuration });
      saveToLocalStorage();
      
    } else {
      // Non-streaming completion
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const finalDuration = Date.now() - startTime;
      
      active.messages.push({ role: 'assistant', content: content, durationMs: finalDuration });
      saveToLocalStorage();
      
      appendMessageToUI('assistant', content, finalDuration);
      scrollToBottom();
    }
    
  } catch (err) {
    removeTypingIndicator();
    console.error('API Fetch Error:', err);
    appendMessageToUI('assistant', `⚠️ **Network Error**: Failed to reach the local proxy server. Please ensure \`node server.js\` is running at \`http://localhost:${window.location.port || '3001'}\`.`);
  }
}

// ==========================================================================
// MARKDOWN & CODE RICH TEXT PARSER
// ==========================================================================
function formatMessageText(text) {
  if (!text) return '<div class="md-p"></div>';
  
  // Format code blocks first to protect code contents
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let formatted = text;
  
  let codeBlocks = [];
  formatted = formatted.replace(codeBlockRegex, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
    codeBlocks.push({
      lang: lang || 'txt',
      code: code
    });
    return placeholder;
  });
  
  // Escape HTML of the non-code text to prevent injection
  formatted = escapeHTML(formatted);
  
  // Inline bold **bold**
  formatted = formatted.replace(/\*\*([\s\S]*?)\*\*/g, '<span class="md-bold">$1</span>');
  
  // Inline monospaced code `code`
  formatted = formatted.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  
  // Block lists (ordered list: 1. text)
  const orderedListRegex = /(?:^|\n)(\d+)\.\s+([^\n]+)/g;
  formatted = formatted.replace(orderedListRegex, (match, num, content) => {
    return `<ol class="md-list"><li class="md-list-item" value="${num}">${content}</li></ol>`;
  });
  
  // Block lists (unordered bullet: - text, * text)
  const unorderedListRegex = /(?:^|\n)[-*]\s+([^\n]+)/g;
  formatted = formatted.replace(unorderedListRegex, (match, content) => {
    return `<ul class="md-bullet-list"><li class="md-bullet-item">${content}</li></ul>`;
  });
  
  // Clean up adjacent OL/UL lists by merging their lists
  formatted = formatted.replace(/<\/ol>\s*<ol class="md-list">/g, '');
  formatted = formatted.replace(/<\/ul>\s*<ul class="md-bullet-list">/g, '');
  
  // Split paragraphs by double newline
  const paragraphs = formatted.split(/\n\n+/);
  formatted = paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    // If it's already list tags, don't wrap in <p>
    if (trimmed.startsWith('<ol') || trimmed.startsWith('<ul') || trimmed.startsWith('__CODE_BLOCK_PLACEHOLDER_')) {
      return trimmed;
    }
    return `<div class="md-p">${trimmed.replace(/\n/g, '<br>')}</div>`;
  }).join('\n');
  
  // Re-inject code blocks with modern UI formatting
  codeBlocks.forEach((block, idx) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${idx}__`;
    
    // Modern Fenced Code Block structure
    const codeBlockHtml = `
      <div class="md-code-block">
        <div class="code-header">
          <span>${block.lang}</span>
          <button class="code-copy-btn" data-code="${encodeURIComponent(block.code)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          </button>
        </div>
        <pre class="md-code-pre"><code class="language-${block.lang}">${escapeHTML(block.code)}</code></pre>
      </div>
    `;
    
    formatted = formatted.replace(placeholder, codeBlockHtml);
  });
  
  return formatted;
}

// Utility: copy code snippets to clipboard
function attachCodeCopyEvents(container) {
  container.querySelectorAll('.code-copy-btn').forEach(btn => {
    // Remove if already has listener to avoid double-binding
    if (btn.getAttribute('data-has-listener')) return;
    
    btn.setAttribute('data-has-listener', 'true');
    btn.addEventListener('click', async () => {
      const code = decodeURIComponent(btn.getAttribute('data-code'));
      try {
        await navigator.clipboard.writeText(code);
        
        // Show success status
        const textSpan = btn.querySelector('span');
        const originalText = textSpan.textContent;
        textSpan.textContent = 'Copied!';
        btn.style.color = 'var(--accent-success)';
        
        setTimeout(() => {
          textSpan.textContent = originalText;
          btn.style.color = '';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    });
  });
}

// Helper: Escape standard HTML strings to prevent XSS
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
