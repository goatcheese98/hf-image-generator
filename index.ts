import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { ImageProvider } from './provider';
import { blobToBase64 } from './utils';

// Global variables
let hf: ImageProvider | null = null;
let currentToken = '';
let uploadedReference: Blob | null = null;

// UI Elements
function required<T extends HTMLElement>(id: string, type: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing or invalid element: ${id}`);
  return element;
}
const elements = {
  credentialMode: required('credential-mode', HTMLSelectElement),
  tokenInput: required('token-input', HTMLInputElement),
  modelSelect: required('model-select', HTMLSelectElement),
  promptInput: required('prompt-input', HTMLTextAreaElement),
  generateBtn: required('generate-btn', HTMLButtonElement),
  testTokenBtn: required('test-token-btn', HTMLButtonElement),
  testApiBtn: required('test-api-btn', HTMLButtonElement),
  oldImage: required('old-image', HTMLImageElement),
  newImage: required('new-image', HTMLImageElement),
  loadingSpinner: required('loading-spinner', HTMLElement),
  errorMessage: required('error-message', HTMLElement),
  successMessage: required('success-message', HTMLElement),
  tokenStatusText: required('token-status-text', HTMLElement),
  apiStatusText: required('api-status-text', HTMLElement),
  generationStatusText: required('generation-status-text', HTMLElement),
  debugOutput: required('debug-output', HTMLElement),
  clearDebugBtn: required('clear-debug-btn', HTMLButtonElement),
  generateModeRadio: required('generate-mode', HTMLInputElement),
  recreateModeRadio: required('recreate-mode', HTMLInputElement),
  generateModeContent: required('generate-mode-content', HTMLElement),
  recreateModeContent: required('recreate-mode-content', HTMLElement),
  generateResults: required('generate-results', HTMLElement),
  recreateResults: required('recreate-results', HTMLElement),
  recreateModelSelect: required('recreate-model-select', HTMLSelectElement),
  recreatePromptInput: required('recreate-prompt', HTMLInputElement),
  recreateBtn: required('recreate-btn', HTMLButtonElement),
  testRecreateApiBtn: required('test-recreate-api-btn', HTMLButtonElement),
  recreateApiStatusText: required('recreate-api-status-text', HTMLElement),
  recreationStatusText: required('recreation-status-text', HTMLElement),
  referenceImageInput: required('reference-image-input', HTMLInputElement),
  recreatedImage: required('recreated-image', HTMLImageElement),
  recreateLoadingSpinner: required('recreate-loading-spinner', HTMLElement),
  recreatePlaceholderText: required('recreate-placeholder-text', HTMLElement),
};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  initializeElements();
  setupEventListeners();
  initializeHF();
  updateStatus('generation', 'Ready', 'info');

  // Initialize debug console as collapsed
  const debugConsole = required('debug-console', HTMLElement);
  const debugToggle = required('debug-toggle', HTMLElement);
  if (debugConsole && debugToggle) {
    debugConsole.classList.add('collapsed');
    required('debug-header', HTMLElement).setAttribute('aria-expanded', 'false');
    debugToggle.textContent = '+';
    debugToggle.style.transform = 'rotate(-90deg)';
  }
});

function initializeElements() {
  elements.promptInput.value = 'A beautiful landscape with mountains, trees, and a clear blue sky';
}

function setupEventListeners() {
  elements.testTokenBtn.addEventListener('click', testToken);
  elements.testApiBtn.addEventListener('click', testApiConnection);
  elements.generateBtn.addEventListener('click', generateImage);
  elements.clearDebugBtn.addEventListener('click', clearDebug);

  // Mode toggle listeners
  elements.generateModeRadio.addEventListener('change', toggleMode);
  elements.recreateModeRadio.addEventListener('change', toggleMode);

  // Recreate mode listeners
  elements.testRecreateApiBtn.addEventListener('click', testRecreateApiConnection);
  elements.recreateBtn.addEventListener('click', recreateImage);
  elements.referenceImageInput.addEventListener('change', handleReferenceImageUpload);

  elements.credentialMode.addEventListener('change', () => {
    currentToken = ''; elements.tokenInput.value = '';
    const hosted = elements.credentialMode.value === 'service';
    elements.tokenInput.disabled = hosted;
    for (const select of [elements.modelSelect, elements.recreateModelSelect]) {
      for (const option of select.options) option.disabled = hosted && option.index !== 0;
      if (hosted) select.selectedIndex = 0;
    }
    initializeHF();
  });

  // Update token when input changes
  elements.tokenInput.addEventListener('input', () => {
    currentToken = elements.tokenInput.value.trim();
    initializeHF();
  });
}

function initializeHF() {
  const hosted = elements.credentialMode.value === 'service';
  hf = hosted ? new ImageProvider('', 'service') : currentToken ? new ImageProvider(currentToken) : null;
  updateStatus('token', hosted ? 'Hosted access required' : currentToken ? 'Token loaded' : 'No token provided', hosted || currentToken ? 'info' : 'warning');
  debugLog(currentToken ? 'User credential loaded in memory' : 'Enter a token to use the provider');
}

function updateStatus(type: 'token' | 'api' | 'generation', message: string, statusType: string) {
  const statusElement = elements[`${type}StatusText`];
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = `status-${statusType}`;
  }
}

function showMessage(message: string, isError = false) {
  hideMessages();
  const messageElement = isError ? elements.errorMessage : elements.successMessage;
  messageElement.textContent = message;
  messageElement.style.display = 'block';

  // Auto-hide after 5 seconds
  setTimeout(() => {
    messageElement.style.display = 'none';
  }, 5000);
}

function hideMessages() {
  elements.errorMessage.style.display = 'none';
  elements.successMessage.style.display = 'none';
}

function showLoading(show = true) {
  elements.loadingSpinner.style.display = show ? 'flex' : 'none';
  elements.generateBtn.disabled = show;
  elements.testApiBtn.disabled = show;
}

async function testToken() {
  if (!hf) { showMessage('Enter a token to test', true); return; }
  const provider = hf;
  elements.testTokenBtn.disabled = true;
  try {
    await provider.validateToken();
    if (provider !== hf) return;
    updateStatus('token', elements.credentialMode.value === 'service' ? 'Valid - Hosted access' : 'Valid - User', 'success');
    showMessage('Token is valid and working!');
  } catch {
    if (provider !== hf) return;
    updateStatus('token', 'Invalid - token', 'error');
    showMessage('Token validation failed', true);
  } finally { elements.testTokenBtn.disabled = false; }
}

async function testApiConnection() { await runGeneration(false, true); }
async function generateImage() { await runGeneration(false); }

async function runGeneration(recreate: boolean, test = false) {
  if (!hf) { showMessage('Please enter a token first', true); return; }
  const provider = hf;
  const model = recreate ? elements.recreateModelSelect.value : elements.modelSelect.value;
  const prompt = test ? 'test image generation' : (recreate ? elements.recreatePromptInput.value : elements.promptInput.value).trim();
  if (!prompt) { showMessage('Please enter a prompt', true); return; }
  const image = recreate ? elements.recreatedImage : elements.newImage;
  const download = required(recreate ? 'download-recreated' : 'download-image', HTMLAnchorElement);
  const placeholder = recreate ? elements.recreatePlaceholderText : required('placeholder-text', HTMLElement);
  const status = (message: string, type: string) => recreate
    ? updateRecreateStatus(test ? 'api' : 'recreation', message, type)
    : updateStatus(test ? 'api' : 'generation', message, type);
  if (recreate) showRecreateLoading(true); else showLoading(true);
  if (!test) { download.hidden = true; download.removeAttribute('href'); image.removeAttribute('src'); image.style.display = 'none'; placeholder.style.display = 'block'; }
  try {
    status(test ? 'Testing connection...' : 'Generating image...', 'info');
    const result = recreate
      ? await provider.recreate({model, prompt, reference: await getReferenceImageBlob()})
      : await provider.generate({model, prompt});
    if (provider !== hf) return;
    if (!test) {
      const source = await blobToBase64(result.image);
      if (provider !== hf) return;
      image.src = source;
      download.href = source; download.hidden = false;
      download.download = `${recreate ? 'recreated' : 'generated'}-image.${result.image.type === 'image/jpeg' ? 'jpg' : result.image.type === 'image/webp' ? 'webp' : 'png'}`;
      image.style.display = 'block'; placeholder.style.display = 'none';
    }
    status(test ? 'Connection successful' : 'Image generated successfully!', 'success');
    showMessage(test ? 'API connection is working!' : 'Image generated successfully!');
    debugLog(result.method === 'enhanced-text' ? 'Created using enhanced text fallback' : 'Provider request completed', 'success');
  } catch {
    if (provider !== hf) return;
    status(test ? 'Connection failed' : 'Generation failed', 'error');
    showMessage('Provider request failed. Check your token, model access and provider availability.', true);
    debugLog('Provider request failed', 'error');
  } finally {
    if (recreate) showRecreateLoading(false); else showLoading(false);
  }
}

// Debug console functions
function debugLog(message: string, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
  const logMessage = `[${timestamp}] ${prefix} ${message}`;

  if (elements.debugOutput) {
    const logElement = document.createElement('div');
    logElement.textContent = logMessage;
    logElement.className = `debug-line debug-${type}`;
    elements.debugOutput.appendChild(logElement);
    elements.debugOutput.scrollTop = elements.debugOutput.scrollHeight;
  }

  // Also log to browser console
  console.log(logMessage);
}

function clearDebug() {
  if (elements.debugOutput) {
    elements.debugOutput.innerHTML = '';
  }
}

// Toggle debug console visibility
function toggleDebugConsole() {
  const debugConsole = required('debug-console', HTMLElement);
  const debugToggle = required('debug-toggle', HTMLElement);

  if (debugConsole.classList.contains('collapsed')) {
    debugConsole.classList.remove('collapsed');
    required('debug-header', HTMLElement).setAttribute('aria-expanded', 'true');
    debugToggle.textContent = '-';
    debugToggle.style.transform = 'rotate(0deg)';
  } else {
    debugConsole.classList.add('collapsed');
    required('debug-header', HTMLElement).setAttribute('aria-expanded', 'false');
    debugToggle.textContent = '+';
    debugToggle.style.transform = 'rotate(-90deg)';
  }
}

// Keep the debug control inside the module.
required('debug-header', HTMLElement).addEventListener('click', toggleDebugConsole);

// Mode toggle functionality
function toggleMode() {
  const isGenerateMode = elements.generateModeRadio.checked;

  // Toggle content visibility
  elements.generateModeContent.style.display = isGenerateMode ? 'block' : 'none';
  elements.recreateModeContent.style.display = isGenerateMode ? 'none' : 'block';

  // Toggle results visibility
  elements.generateResults.style.display = isGenerateMode ? 'block' : 'none';
  elements.recreateResults.style.display = isGenerateMode ? 'none' : 'block';

  debugLog(`Switched to ${isGenerateMode ? 'Generate' : 'Recreate'} mode`);
}

// Handle reference image upload
async function handleReferenceImageUpload() {
  const file = elements.referenceImageInput.files?.[0];
  if (!file) return;
  if (file.size > 2_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showMessage('Use a PNG, JPEG or WebP reference image up to 2 MB', true); return;
  }
  try { elements.oldImage.src = await blobToBase64(file); uploadedReference = file; }
  catch { showMessage('Failed to read reference image', true); }
}

async function testRecreateApiConnection() { await runGeneration(true, true); }

// Update status for recreate mode
function updateRecreateStatus(type: 'api' | 'recreation', message: string, statusType: string) {
  let statusElement;
  if (type === 'api') {
    statusElement = elements.recreateApiStatusText;
  } else if (type === 'recreation') {
    statusElement = elements.recreationStatusText;
  }

  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = `status-value status-${statusType}`;
  }
}

async function recreateImage() { await runGeneration(true); }

async function getReferenceImageBlob(): Promise<Blob> {
  if (uploadedReference) return uploadedReference;
  const response = await fetch(elements.oldImage.src);
  if (!response.ok) throw new Error('Failed to load reference image');
  return response.blob();
}

// Show/hide loading for recreate mode
function showRecreateLoading(show = true) {
  if (elements.recreateLoadingSpinner) {
    elements.recreateLoadingSpinner.style.display = show ? 'flex' : 'none';
  }
  elements.recreateBtn.disabled = show;
  elements.testRecreateApiBtn.disabled = show;
}
