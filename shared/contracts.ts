export const MODELS = [
  'black-forest-labs/FLUX.1-schnell', 'black-forest-labs/FLUX.1-dev',
  'stabilityai/stable-diffusion-xl-base-1.0', 'stabilityai/stable-diffusion-3.5-large',
  'stabilityai/stable-diffusion-3.5-medium', 'runwayml/stable-diffusion-v1-5',
  'CompVis/stable-diffusion-v1-4',
] as const;
export const API_PATH = '/hf-image-generator/api/provider';
export const LIMITS = {requestBytes: 2_900_000, referenceBytes: 2_000_000, responseBytes: 5_000_000,
  prompt: 2000, timeoutMs: 30_000, attempts: 3} as const;
export interface GenerateRequest {model: string; prompt: string}
export interface RecreateRequest extends GenerateRequest {reference: Blob}
export interface ImageResult {image: Blob; method: 'text' | 'image' | 'enhanced-text'}
export type CredentialMode = 'user' | 'service';
export type ProviderRequest = {action: 'token'} | (GenerateRequest & {action: 'generate' | 'recreate'; reference?: string});
