import { HfInference } from '@huggingface/inference';

export interface GenerateRequest { model: string; prompt: string }
export interface RecreateRequest extends GenerateRequest { reference: Blob }
export interface ImageResult { image: Blob; method: 'text' | 'image' | 'enhanced-text' }
interface ImageParameters {
  prompt: string;
  strength: number;
  guidance_scale: number;
  num_inference_steps: number;
  controlnet_conditioning_scale?: number;
  control_guidance_start?: number;
  control_guidance_end?: number;
}
class ProviderError extends Error {
  constructor(readonly status: number) { super(`Provider request failed (${status})`); }
}

// Credentials are owned by the caller and retained only in memory. Never log responses
// or SDK errors: a provider may echo sensitive request headers in an error body.
export class ImageProvider {
  private readonly client: HfInference;
  constructor(private readonly token: string) { this.client = new HfInference(token); }

  async validateToken(): Promise<void> {
    const response = await fetch('https://huggingface.co/api/whoami-v2', {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new ProviderError(response.status);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('name' in result) || typeof result.name !== 'string') {
      throw new Error('Invalid identity response');
    }
  }

  private async request(model: string, body: () => BodyInit, json: boolean, delay: number): Promise<Blob> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, ...(json ? {'Content-Type': 'application/json'} : {}) },
        body: body(),
      });
      if (response.status === 503 && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) throw new ProviderError(response.status);
      if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Expected an image');
      const image = await response.blob();
      if (!image.size) throw new Error('Empty image');
      return image;
    }
    throw new Error('Retry exhausted');
  }

  async generate({model, prompt}: GenerateRequest): Promise<ImageResult> {
    const request = {model, inputs: prompt, parameters: {width: 512, height: 512, num_inference_steps: 20, guidance_scale: 7.5}};
    try {
      const image = await this.client.textToImage(request);
      if (!image.size || !image.type.startsWith('image/')) throw new Error('Expected an image');
      return {image, method: 'text'};
    } catch {
      const {model: _model, ...payload} = request;
      return {image: await this.request(model, () => JSON.stringify(payload), true, 10000), method: 'text'};
    }
  }

  async recreate({model, prompt, reference}: RecreateRequest): Promise<ImageResult> {
    const control = model.toLowerCase().includes('controlnet');
    const parameters: ImageParameters = {prompt, strength: control ? 0.8 : 0.75, guidance_scale: 7.5, num_inference_steps: 20,
      ...(control ? {controlnet_conditioning_scale: 1, control_guidance_start: 0, control_guidance_end: 1} : {})};
    try {
      const image = await this.request(model, () => {
        const form = new FormData();
        form.append('inputs', reference); form.append('parameters', JSON.stringify(parameters));
        return form;
      }, false, 15000);
      return {image, method: 'image'};
    } catch (error) {
      if (!(error instanceof ProviderError) || ![400, 404].includes(error.status)) throw error;
      const enhanced = control
        ? `${prompt}, maintaining original structure and composition, edge-guided transformation, precise control, high quality, detailed`
        : `${prompt}, based on a vintage black and white photograph, maintaining the original composition and subject matter, high quality, detailed`;
      const result = await this.generate({model, prompt: enhanced});
      return {...result, method: 'enhanced-text'};
    }
  }
}
