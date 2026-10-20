import { API_PATH, LIMITS, type CredentialMode, type GenerateRequest, type RecreateRequest, type ImageResult, type ProviderRequest } from './shared/contracts';
import { blobToBase64 } from './utils';
export type { GenerateRequest, RecreateRequest, ImageResult } from './shared/contracts';

// Only intentionally entered user credentials may exist here. Hosted provider
// credentials are selected and authorized exclusively inside the server handler.
export class ImageProvider {
  constructor(private readonly token: string, private readonly mode: CredentialMode = 'user') {}
  private async request(input: ProviderRequest): Promise<Response> {
    const response = await fetch(API_PATH, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.timeout(LIMITS.timeoutMs + 5000),
      headers: {'Content-Type': 'application/json', 'X-Credential-Mode': this.mode,
        ...(this.mode === 'user' ? {Authorization: `Bearer ${this.token}`} : {})},
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error('Provider request unavailable');
    return response;
  }
  async validateToken(): Promise<void> {await this.request({action: 'token'});}
  private async image(input: ProviderRequest): Promise<ImageResult> {
    const response = await this.request(input);
    const image = await response.blob();
    const method = response.headers.get('X-Image-Method');
    if (!image.size || image.size > LIMITS.responseBytes || !['image/png','image/jpeg','image/webp'].includes(image.type)
      || !['text','image','enhanced-text'].includes(method ?? '')) throw new Error('Invalid image response');
    return {image, method: method as ImageResult['method']};
  }
  async generate(input: GenerateRequest): Promise<ImageResult> {
    return this.image({action: 'generate', ...input});
  }
  async recreate({model, prompt, reference}: RecreateRequest): Promise<ImageResult> {
    if (reference.size > LIMITS.referenceBytes) throw new Error('Reference image is too large');
    return this.image({action: 'recreate', model, prompt, reference: await blobToBase64(reference)});
  }
}
