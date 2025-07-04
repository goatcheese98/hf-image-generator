import { HfInference } from '@huggingface/inference'
import { blobToBase64 } from './utils.js'

// Global variables
let hf = null;
let currentToken = import.meta.env.VITE_HF_TOKEN;

// UI Elements
const elements = {
  tokenInput: null,
  modelSelect: null,
  promptInput: null,
  generateBtn: null,
  testTokenBtn: null,
  testApiBtn: null,
  oldImage: null,
  newImage: null,
  loadingSpinner: null,
  errorMessage: null,
  successMessage: null,
  tokenStatusText: null,
  apiStatusText: null,
  generationStatusText: null,
  debugOutput: null,
  clearDebugBtn: null,
  // Recreate mode elements
  generateModeRadio: null,
  recreateModeRadio: null,
  generateModeContent: null,
  recreateModeContent: null,
  generateResults: null,
  recreateResults: null,
  recreateModelSelect: null,
  recreatePromptInput: null,
  recreateBtn: null,
  testRecreateApiBtn: null,
  recreateApiStatusText: null,
  recreationStatusText: null,
  referenceImageInput: null,
  recreatedImage: null,
  recreateLoadingSpinner: null,
  recreatePlaceholderText: null
};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  initializeElements();
  setupEventListeners();
  initializeHF();
  updateStatus('generation', 'Ready', 'info');
  
  // Initialize debug console as collapsed
  const debugConsole = document.getElementById('debug-console');
  const debugToggle = document.getElementById('debug-toggle');
  if (debugConsole && debugToggle) {
    debugConsole.classList.add('collapsed');
    debugToggle.textContent = '▶';
    debugToggle.style.transform = 'rotate(-90deg)';
  }
});

function initializeElements() {
  elements.tokenInput = document.getElementById('token-input');
  elements.modelSelect = document.getElementById('model-select');
  elements.promptInput = document.getElementById('prompt-input');
  elements.generateBtn = document.getElementById('generate-btn');
  elements.testTokenBtn = document.getElementById('test-token-btn');
  elements.testApiBtn = document.getElementById('test-api-btn');
  elements.oldImage = document.getElementById('old-image');
  elements.newImage = document.getElementById('new-image');
  elements.loadingSpinner = document.getElementById('loading-spinner');
  elements.errorMessage = document.getElementById('error-message');
  elements.successMessage = document.getElementById('success-message');
  elements.tokenStatusText = document.getElementById('token-status-text');
  elements.apiStatusText = document.getElementById('api-status-text');
  elements.generationStatusText = document.getElementById('generation-status-text');
  elements.debugOutput = document.getElementById('debug-output');
  elements.clearDebugBtn = document.getElementById('clear-debug-btn');
  
  // Recreate mode elements
  elements.generateModeRadio = document.getElementById('generate-mode');
  elements.recreateModeRadio = document.getElementById('recreate-mode');
  elements.generateModeContent = document.getElementById('generate-mode-content');
  elements.recreateModeContent = document.getElementById('recreate-mode-content');
  elements.generateResults = document.getElementById('generate-results');
  elements.recreateResults = document.getElementById('recreate-results');
  elements.recreateModelSelect = document.getElementById('recreate-model-select');
  elements.recreatePromptInput = document.getElementById('recreate-prompt');
  elements.recreateBtn = document.getElementById('recreate-btn');
  elements.testRecreateApiBtn = document.getElementById('test-recreate-api-btn');
  elements.recreateApiStatusText = document.getElementById('recreate-api-status-text');
  elements.recreationStatusText = document.getElementById('recreation-status-text');
  elements.referenceImageInput = document.getElementById('reference-image-input');
  elements.recreatedImage = document.getElementById('recreated-image');
  elements.recreateLoadingSpinner = document.getElementById('recreate-loading-spinner');
  elements.recreatePlaceholderText = document.getElementById('recreate-placeholder-text');
  
  // Set default prompt
  elements.promptInput.value = "A beautiful landscape with mountains, trees, and a clear blue sky";
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
  
  // Update token when input changes
  elements.tokenInput.addEventListener('input', (e) => {
    currentToken = e.target.value.trim() || import.meta.env.VITE_HF_TOKEN;
    initializeHF();
  });
}

function initializeHF() {
  try {
    hf = new HfInference(currentToken);
    if (currentToken) {
      updateStatus('token', 'Token loaded', 'info');
      debugLog(`HF client initialized with token: ${currentToken.substring(0, 8)}...`);
    } else {
      updateStatus('token', 'No token provided', 'warning');
      debugLog('No token provided - using environment variable', 'error');
    }
  } catch (error) {
    updateStatus('token', 'Failed to initialize', 'error');
    debugLog(`HF initialization failed: ${error.message}`, 'error');
    console.error('HF initialization error:', error);
  }
}

function updateStatus(type, message, statusType) {
  const statusElement = elements[`${type}StatusText`];
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = `status-${statusType}`;
  }
}

function showMessage(message, isError = false) {
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
  const inputToken = elements.tokenInput.value.trim();
  const tokenToTest = inputToken || import.meta.env.VITE_HF_TOKEN;
  
  if (!tokenToTest) {
    showMessage('No token available to test (neither input nor .env)', true);
    updateStatus('token', 'No token available', 'error');
    debugLog('No token available for testing', 'error');
    return;
  }

  try {
    updateStatus('token', 'Testing...', 'info');
    debugLog('Starting token validation...');
    elements.testTokenBtn.disabled = true;
    
    // Test with a simple API call
    const response = await fetch('https://huggingface.co/api/whoami-v2', {
      headers: {
        'Authorization': `Bearer ${tokenToTest}`
      }
    });
    
    debugLog(`Token validation response status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      const tokenSource = inputToken ? data.name || 'User' : '.env';
      updateStatus('token', `Valid - ${tokenSource}`, 'success');
      showMessage('Token is valid and working!');
      debugLog(`Token is valid for user: ${data.name || 'Unknown'}`, 'success');
    } else {
      const tokenSource = inputToken ? 'token' : '.env';
      updateStatus('token', `Invalid - ${tokenSource}`, 'error');
      throw new Error(`Token validation failed: ${response.status}`);
    }
  } catch (error) {
    const tokenSource = inputToken ? 'token' : '.env';
    updateStatus('token', `Invalid - ${tokenSource}`, 'error');
    showMessage(`Token test failed: ${error.message}`, true);
    debugLog(`Token validation failed: ${error.message}`, 'error');
    console.error('Token test error:', error);
  } finally {
    elements.testTokenBtn.disabled = false;
  }
}

async function testApiConnection() {
  if (!hf) {
    showMessage('Please initialize HF client first', true);
    debugLog('HF client not initialized', 'error');
    return;
  }

  try {
    updateStatus('api', 'Testing connection...', 'info');
    debugLog('Starting API connection test...');
    elements.testApiBtn.disabled = true;
    
    // Test with HF Inference provider using the new API
    debugLog('Testing HF Inference provider API...');
    
    try {
      // Use the HF Inference library's textToImage method
      const result = await hf.textToImage({
        model: 'black-forest-labs/FLUX.1-schnell',
        inputs: 'a simple test image',
        parameters: {
          width: 512,
          height: 512
        }
      });
      
      debugLog('HF Inference API test successful', 'success');
      updateStatus('api', 'Connection successful', 'success');
      showMessage('API connection is working!');
      
    } catch (hfError) {
      debugLog(`HF Inference API failed: ${hfError.message}`, 'error');
      
      // Fallback to direct API test with new endpoint structure
      debugLog('Trying direct API call as fallback...');
      
      const response = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: 'a simple test image'
        })
      });
      
      debugLog(`Direct API response status: ${response.status}`);
      
      if (response.ok || response.status === 503) {
        updateStatus('api', 'Connection successful', 'success');
        showMessage('API connection is working!');
        debugLog('Direct API test successful', 'success');
      } else {
        const errorText = await response.text();
        debugLog(`Direct API failed: ${response.status} - ${errorText}`, 'error');
        throw new Error(`API test failed: ${response.status} - ${errorText}`);
      }
    }
    
  } catch (error) {
    debugLog(`API test failed: ${error.message}`, 'error');
    updateStatus('api', 'Connection failed', 'error');
    showMessage(`API test failed: ${error.message}`, true);
    console.error('API test error:', error);
  } finally {
    elements.testApiBtn.disabled = false;
  }
}

async function generateImage() {
  if (!hf) {
    showMessage('Please initialize HF client first', true);
    debugLog('HF client not initialized', 'error');
    return;
  }

  const selectedModel = elements.modelSelect.value;
  const customPrompt = elements.promptInput.value.trim();
  
  if (!customPrompt) {
    showMessage('Please enter a prompt', true);
    debugLog('No prompt provided', 'error');
    return;
  }

  try {
    showLoading(true);
    updateStatus('generation', 'Generating image...', 'info');
    debugLog(`Starting image generation with model: ${selectedModel}`);
    debugLog(`Prompt: ${customPrompt}`);
    
    // Clear previous image and hide placeholder
    elements.newImage.src = '';
    elements.newImage.style.display = 'none';
    const placeholder = document.getElementById('placeholder-text');
    if (placeholder) placeholder.style.display = 'block';
    
    let imageBlob;
    
    try {
      // Try using the HF Inference library first (recommended approach)
      debugLog('Using HF Inference library...');
      
      imageBlob = await hf.textToImage({
        model: selectedModel,
        inputs: customPrompt,
        parameters: {
          width: 512,
          height: 512,
          num_inference_steps: 20,
          guidance_scale: 7.5
        }
      });
      
      debugLog('HF Inference library successful');
      
    } catch (hfError) {
      debugLog(`HF Inference library failed: ${hfError.message}`, 'error');
      debugLog('Falling back to direct API call...');
      
      // Fallback to direct API call
      const response = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: customPrompt,
          parameters: {
            width: 512,
            height: 512,
            num_inference_steps: 20,
            guidance_scale: 7.5
          }
        })
      });
      
      debugLog(`Direct API response status: ${response.status}`);
      
      if (response.ok) {
        imageBlob = await response.blob();
        debugLog('Direct API call successful');
      } else if (response.status === 503) {
        // Model is loading, wait and retry
        debugLog('Model is loading, waiting 10 seconds and retrying...');
        updateStatus('generation', 'Model loading, please wait...', 'info');
        
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Retry the request
        const retryResponse = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: customPrompt,
            parameters: {
              width: 512,
              height: 512,
              num_inference_steps: 20,
              guidance_scale: 7.5
            }
          })
        });
        
        debugLog(`Retry API response status: ${retryResponse.status}`);
        
        if (retryResponse.ok) {
          imageBlob = await retryResponse.blob();
          debugLog('Retry API call successful');
        } else {
          const errorText = await retryResponse.text();
          debugLog(`Retry API call failed: ${retryResponse.status} - ${errorText}`, 'error');
          throw new Error(`API call failed after retry: ${retryResponse.status} - ${errorText}`);
        }
      } else {
        const errorText = await response.text();
        debugLog(`Direct API call failed: ${response.status} - ${errorText}`, 'error');
        throw new Error(`API call failed: ${response.status} - ${errorText}`);
      }
    }
    
    updateStatus('generation', 'Converting image...', 'info');
    debugLog(`Image generated, size: ${imageBlob.size} bytes`);
    
    const newImageBase64 = await blobToBase64(imageBlob);
    
    // Display the new image and hide placeholder
    elements.newImage.src = newImageBase64;
    elements.newImage.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    
    updateStatus('generation', 'Image generated successfully!', 'success');
    showMessage('Image generated successfully!');
    debugLog('Image generation completed successfully', 'success');
    
  } catch (error) {
    updateStatus('generation', 'Generation failed', 'error');
    showMessage(`Generation failed: ${error.message}`, true);
    debugLog(`Image generation failed: ${error.message}`, 'error');
    console.error('Full error details:', error);
    
    // Clear the image on error and show placeholder
    elements.newImage.src = '';
    elements.newImage.style.display = 'none';
    const placeholder = document.getElementById('placeholder-text');
    if (placeholder) placeholder.style.display = 'block';
  } finally {
    showLoading(false);
  }
}

// Debug console functions
function debugLog(message, type = 'info') {
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
  const debugConsole = document.getElementById('debug-console');
  const debugToggle = document.getElementById('debug-toggle');
  
  if (debugConsole.classList.contains('collapsed')) {
    debugConsole.classList.remove('collapsed');
    debugToggle.textContent = '▼';
    debugToggle.style.transform = 'rotate(0deg)';
  } else {
    debugConsole.classList.add('collapsed');
    debugToggle.textContent = '▶';
    debugToggle.style.transform = 'rotate(-90deg)';
  }
}

// Make toggleDebugConsole available globally
window.toggleDebugConsole = toggleDebugConsole;

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
function handleReferenceImageUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      elements.oldImage.src = e.target.result;
      debugLog(`Reference image uploaded: ${file.name} (${file.size} bytes)`);
    };
    reader.readAsDataURL(file);
  }
}

// Test API connection for recreate mode
async function testRecreateApiConnection() {
  if (!hf) {
    showMessage('Please initialize HF client first', true);
    debugLog('HF client not initialized', 'error');
    return;
  }

  try {
    updateRecreateStatus('api', 'Testing connection...', 'info');
    debugLog('Starting recreate API connection test...');
    elements.testRecreateApiBtn.disabled = true;
    
    const selectedModel = elements.recreateModelSelect.value;
    debugLog(`Testing API for model: ${selectedModel}`);
    
    // First try image-to-image if it's a model that might support it
    if (selectedModel.includes('stable-diffusion') || selectedModel.includes('Controlnet') || selectedModel.includes('controlnet')) {
      try {
        debugLog('Testing image-to-image API capability...');
        
        // Get a small version of the reference image for testing
        const referenceImageBlob = await getReferenceImageBlob();
        debugLog(`Using reference image for API test, size: ${referenceImageBlob.size} bytes`);
        
        // Create FormData with test parameters
        const formData = new FormData();
        formData.append('inputs', referenceImageBlob);
        
        // Use different parameters for ControlNet models
        let parameters;
        if (selectedModel.includes('Controlnet') || selectedModel.includes('controlnet')) {
          parameters = {
            prompt: 'test transformation',
            strength: 0.8,
            guidance_scale: 7.5,
            num_inference_steps: 10,
            controlnet_conditioning_scale: 1.0
          };
        } else {
          parameters = {
            prompt: 'test transformation',
            strength: 0.3,
            guidance_scale: 7.5,
            num_inference_steps: 10
          };
        }
        
        formData.append('parameters', JSON.stringify(parameters));
        
        const response = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentToken}`,
          },
          body: formData
        });
        
        debugLog(`Image-to-image API response status: ${response.status}`);
        
        if (response.ok || response.status === 503) {
          const modelType = selectedModel.includes('Controlnet') || selectedModel.includes('controlnet') ? 'ControlNet' : 'Image-to-Image';
          updateRecreateStatus('api', `${modelType} API working`, 'success');
          showMessage(`${modelType} API connection is working!`);
          debugLog(`${modelType} API test successful`, 'success');
          return;
        } else if (response.status === 404 || response.status === 400) {
          debugLog('Image-to-image not supported, testing text-to-image fallback...');
        } else {
          const errorText = await response.text();
          debugLog(`Image-to-image API failed: ${response.status} - ${errorText}`, 'error');
          throw new Error(`API test failed: ${response.status} - ${errorText}`);
        }
        
      } catch (imgError) {
        debugLog(`Image-to-image test failed: ${imgError.message}`, 'error');
        debugLog('Testing text-to-image fallback...');
      }
    }
    
    // Test text-to-image as fallback or primary method
    debugLog('Testing text-to-image API...');
    
    try {
      // Standard text-to-image test for all models
      const result = await hf.textToImage({
        model: selectedModel,
        inputs: 'test image generation',
        parameters: {
          width: 512,
          height: 512,
          num_inference_steps: 10,
          guidance_scale: 7.5
        }
      });
      
      debugLog('Text-to-image API test successful', 'success');
      updateRecreateStatus('api', 'Enhanced Text Generation API working', 'success');
      showMessage('Enhanced Text Generation API connection is working!');
      
    } catch (textError) {
      debugLog(`Text-to-image API failed: ${textError.message}`, 'error');
      
      // Try direct API call as final fallback
      debugLog('Trying direct API call as final fallback...');
      
      const response = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: 'test image generation'
        })
      });
      
      debugLog(`Direct API response status: ${response.status}`);
      
      if (response.ok || response.status === 503) {
        updateRecreateStatus('api', 'Direct API working', 'success');
        showMessage('Direct API connection is working!');
        debugLog('Direct API test successful', 'success');
      } else {
        const errorText = await response.text();
        debugLog(`Direct API failed: ${response.status} - ${errorText}`, 'error');
        throw new Error(`API test failed: ${response.status} - ${errorText}`);
      }
    }
    
  } catch (error) {
    debugLog(`API test failed: ${error.message}`, 'error');
    updateRecreateStatus('api', 'Connection failed', 'error');
    showMessage(`API test failed: ${error.message}`, true);
    console.error('API test error:', error);
  } finally {
    elements.testRecreateApiBtn.disabled = false;
  }
}

// Update status for recreate mode
function updateRecreateStatus(type, message, statusType) {
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

// Recreate image functionality
async function recreateImage() {
  if (!hf) {
    showMessage('Please initialize HF client first', true);
    debugLog('HF client not initialized', 'error');
    return;
  }

  const selectedModel = elements.recreateModelSelect.value;
  const transformPrompt = elements.recreatePromptInput.value.trim();
  
  if (!transformPrompt) {
    showMessage('Please enter a transformation prompt', true);
    debugLog('No transformation prompt provided', 'error');
    return;
  }

  try {
    showRecreateLoading(true);
    updateRecreateStatus('recreation', 'Recreating image...', 'info');
    debugLog(`Starting image recreation with model: ${selectedModel}`);
    debugLog(`Transformation prompt: ${transformPrompt}`);
    
    // Clear previous image and hide placeholder
    elements.recreatedImage.src = '';
    elements.recreatedImage.style.display = 'none';
    if (elements.recreatePlaceholderText) elements.recreatePlaceholderText.style.display = 'block';
    
    // Get the reference image as a blob
    const referenceImageBlob = await getReferenceImageBlob();
    debugLog(`Reference image loaded, size: ${referenceImageBlob.size} bytes`);
    
    let imageBlob;
    
    // Use direct API call with proper image-to-image format
    debugLog('Using direct API call for image-to-image transformation...');
    
    // Create FormData with both image and parameters
    const formData = new FormData();
    formData.append('inputs', referenceImageBlob);
    
    // Add parameters based on model type
    let parameters;
    if (selectedModel.includes('Controlnet') || selectedModel.includes('controlnet')) {
      // ControlNet models need specific parameters
      parameters = {
        prompt: transformPrompt,
        strength: 0.8, // Higher strength for ControlNet
        guidance_scale: 7.5,
        num_inference_steps: 20,
        controlnet_conditioning_scale: 1.0, // ControlNet specific parameter
        control_guidance_start: 0.0,
        control_guidance_end: 1.0
      };
      debugLog('Using ControlNet-specific parameters');
    } else {
      // Standard image-to-image parameters
      parameters = {
        prompt: transformPrompt,
        strength: 0.75,
        guidance_scale: 7.5,
        num_inference_steps: 20
      };
      debugLog('Using standard image-to-image parameters');
    }
    
    formData.append('parameters', JSON.stringify(parameters));
    
    const response = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`,
      },
      body: formData
    });
    
    debugLog(`Direct API response status for image-to-image: ${response.status}`);
    
    if (response.ok) {
      imageBlob = await response.blob();
      const modelType = selectedModel.includes('Controlnet') || selectedModel.includes('controlnet') ? 'ControlNet' : 'image-to-image';
      debugLog(`Direct API call successful for ${modelType}`);
    } else if (response.status === 503) {
      // Model is loading, wait and retry
      debugLog('Model is loading for image-to-image, waiting 15 seconds and retrying...');
      updateRecreateStatus('recreation', 'Model loading, please wait...', 'info');
      
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Retry the request
      const retryFormData = new FormData();
      retryFormData.append('inputs', referenceImageBlob);
      retryFormData.append('parameters', JSON.stringify(parameters));
      
      const retryResponse = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
        },
        body: retryFormData
      });
      
      debugLog(`Retry API response status for image-to-image: ${retryResponse.status}`);
      
      if (retryResponse.ok) {
        imageBlob = await retryResponse.blob();
        debugLog('Retry API call successful for image-to-image');
      } else {
        const errorText = await retryResponse.text();
        debugLog(`Retry API call failed for image-to-image: ${retryResponse.status} - ${errorText}`, 'error');
        
        // If the model doesn't support image-to-image, fall back to text-to-image with reference description
        if (retryResponse.status === 404 || retryResponse.status === 400) {
          debugLog('Model may not support image-to-image, falling back to enhanced text-to-image...');
          return await fallbackToTextToImage(selectedModel, transformPrompt, referenceImageBlob);
        }
        
        throw new Error(`API call failed after retry: ${retryResponse.status} - ${errorText}`);
      }
    } else {
      const errorText = await response.text();
      debugLog(`Direct API call failed for image-to-image: ${response.status} - ${errorText}`, 'error');
      
      // If the model doesn't support image-to-image, fall back to text-to-image with reference description
      if (response.status === 404 || response.status === 400) {
        debugLog('Model may not support image-to-image, falling back to enhanced text-to-image...');
        return await fallbackToTextToImage(selectedModel, transformPrompt, referenceImageBlob);
      }
      
      throw new Error(`API call failed: ${response.status} - ${errorText}`);
    }
    
    updateRecreateStatus('recreation', 'Converting image...', 'info');
    debugLog(`Image recreated, size: ${imageBlob.size} bytes`);
    
    const recreatedImageBase64 = await blobToBase64(imageBlob);
    
    // Display the recreated image and hide placeholder
    elements.recreatedImage.src = recreatedImageBase64;
    elements.recreatedImage.style.display = 'block';
    if (elements.recreatePlaceholderText) elements.recreatePlaceholderText.style.display = 'none';
    
    updateRecreateStatus('recreation', 'Image recreated successfully!', 'success');
    showMessage('Image recreated successfully!');
    debugLog('Image recreation completed successfully', 'success');
    
  } catch (error) {
    updateRecreateStatus('recreation', 'Recreation failed', 'error');
    showMessage(`Recreation failed: ${error.message}`, true);
    debugLog(`Image recreation failed: ${error.message}`, 'error');
    console.error('Full error details:', error);
    
    // Clear the image on error and show placeholder
    elements.recreatedImage.src = '';
    elements.recreatedImage.style.display = 'none';
    if (elements.recreatePlaceholderText) elements.recreatePlaceholderText.style.display = 'block';
  } finally {
    showRecreateLoading(false);
  }
}

// Fallback function for models that don't support image-to-image
async function fallbackToTextToImage(selectedModel, transformPrompt, referenceImageBlob) {
  debugLog('Using fallback text-to-image approach with enhanced prompting...');
  updateRecreateStatus('recreation', 'Using enhanced text generation...', 'info');
  
  // Create enhanced prompt based on model type
  let enhancedPrompt;
  if (selectedModel.includes('Controlnet') || selectedModel.includes('controlnet')) {
    // ControlNet models benefit from structure and control-specific prompts
    enhancedPrompt = `${transformPrompt}, maintaining original structure and composition, edge-guided transformation, precise control, high quality, detailed`;
  } else {
    // Standard enhanced prompt for other models
    enhancedPrompt = `${transformPrompt}, based on a vintage black and white photograph, maintaining the original composition and subject matter, high quality, detailed`;
  }
  
  debugLog(`Enhanced prompt: ${enhancedPrompt}`);
  
  try {
    // First try: Use the HF Inference library's textToImage method
    debugLog('Attempting HF Inference library textToImage...');
    
    const imageBlob = await hf.textToImage({
      model: selectedModel,
      inputs: enhancedPrompt,
      parameters: {
        width: 512,
        height: 512,
        num_inference_steps: 20,
        guidance_scale: 7.5
      }
    });
    
    debugLog('HF Inference library textToImage successful');
    
    const recreatedImageBase64 = await blobToBase64(imageBlob);
    
    // Display the recreated image and hide placeholder
    elements.recreatedImage.src = recreatedImageBase64;
    elements.recreatedImage.style.display = 'block';
    if (elements.recreatePlaceholderText) elements.recreatePlaceholderText.style.display = 'none';
    
    const modelType = selectedModel.includes('Controlnet') || selectedModel.includes('controlnet') ? 'ControlNet' : 'Enhanced text generation';
    updateRecreateStatus('recreation', `Image created successfully! (${modelType})`, 'success');
    showMessage(`Image created successfully using ${modelType.toLowerCase()}!`);
    debugLog('Fallback image creation completed successfully', 'success');
    
  } catch (hfError) {
    debugLog(`HF Inference library failed: ${hfError.message}`, 'error');
    debugLog('Trying direct API call as secondary fallback...');
    
    try {
      // Second try: Direct API call with JSON
      const response = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: enhancedPrompt,
          parameters: {
            width: 512,
            height: 512,
            num_inference_steps: 20,
            guidance_scale: 7.5
          }
        })
      });
      
      debugLog(`Direct API response status: ${response.status}`);
      
      if (response.ok) {
        const imageBlob = await response.blob();
        debugLog('Direct API call successful');
        
        const recreatedImageBase64 = await blobToBase64(imageBlob);
        
        // Display the recreated image and hide placeholder
        elements.recreatedImage.src = recreatedImageBase64;
        elements.recreatedImage.style.display = 'block';
        if (elements.recreatePlaceholderText) elements.recreatePlaceholderText.style.display = 'none';
        
        updateRecreateStatus('recreation', 'Image created successfully! (Direct API)', 'success');
        showMessage('Image created successfully using direct API!');
        debugLog('Direct API fallback completed successfully', 'success');
        
      } else if (response.status === 503) {
        // Model is loading, wait and retry
        debugLog('Model is loading, waiting 15 seconds and retrying...');
        updateRecreateStatus('recreation', 'Model loading, please wait...', 'info');
        
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Retry the direct API call
        const retryResponse = await fetch(`https://api-inference.huggingface.co/models/${selectedModel}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: enhancedPrompt,
            parameters: {
              width: 512,
              height: 512,
              num_inference_steps: 20,
              guidance_scale: 7.5
            }
          })
        });
        
        debugLog(`Retry response status: ${retryResponse.status}`);
        
        if (retryResponse.ok) {
          const imageBlob = await retryResponse.blob();
          debugLog('Retry API call successful');
          
          const recreatedImageBase64 = await blobToBase64(imageBlob);
          
          // Display the recreated image and hide placeholder
          elements.recreatedImage.src = recreatedImageBase64;
          elements.recreatedImage.style.display = 'block';
          if (elements.recreatePlaceholderText) elements.recreatePlaceholderText.style.display = 'none';
          
          updateRecreateStatus('recreation', 'Image created successfully! (Retry)', 'success');
          showMessage('Image created successfully after retry!');
          debugLog('Retry fallback completed successfully', 'success');
          
        } else {
          const errorText = await retryResponse.text();
          debugLog(`Retry failed: ${retryResponse.status} - ${errorText}`, 'error');
          throw new Error(`Retry failed: ${retryResponse.status} - ${errorText}`);
        }
        
      } else {
        const errorText = await response.text();
        debugLog(`Direct API failed: ${response.status} - ${errorText}`, 'error');
        throw new Error(`Direct API failed: ${response.status} - ${errorText}`);
      }
      
    } catch (directError) {
      debugLog(`Direct API also failed: ${directError.message}`, 'error');
      throw new Error(`All fallback methods failed. Last error: ${directError.message}`);
    }
  }
}

// Helper function to get reference image as blob
async function getReferenceImageBlob() {
  return new Promise(async (resolve, reject) => {
    try {
      const imgSrc = elements.oldImage.src;
      
      // If it's a data URL (uploaded image), convert directly
      if (imgSrc.startsWith('data:')) {
        debugLog('Converting data URL to blob...');
        const response = await fetch(imgSrc);
        const blob = await response.blob();
        resolve(blob);
        return;
      }
      
      // For other images, use canvas approach
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = function() {
        try {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          canvas.toBlob(function(blob) {
            if (blob) {
              debugLog(`Successfully converted image to blob: ${blob.size} bytes`);
              resolve(blob);
            } else {
              reject(new Error('Failed to convert image to blob'));
            }
          }, 'image/jpeg', 0.8);
        } catch (canvasError) {
          debugLog(`Canvas error: ${canvasError.message}`, 'error');
          reject(canvasError);
        }
      };
      
      img.onerror = function() {
        debugLog('Failed to load reference image', 'error');
        reject(new Error('Failed to load reference image'));
      };
      
      // Handle CORS for external images
      if (!imgSrc.startsWith(window.location.origin)) {
        img.crossOrigin = 'anonymous';
      }
      
      img.src = imgSrc;
      
    } catch (error) {
      debugLog(`Error in getReferenceImageBlob: ${error.message}`, 'error');
      reject(error);
    }
  });
}

// Show/hide loading for recreate mode
function showRecreateLoading(show = true) {
  if (elements.recreateLoadingSpinner) {
    elements.recreateLoadingSpinner.style.display = show ? 'flex' : 'none';
  }
  elements.recreateBtn.disabled = show;
  elements.testRecreateApiBtn.disabled = show;
}