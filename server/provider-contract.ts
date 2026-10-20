import {MODELS} from '../shared/contracts';
export const SCHNELL_ENDPOINT = 'https://router.huggingface.co/nscale/v1/images/generations';
export function providerContract(model: string, prompt: string, reference?: string) {
  if (model === MODELS[0]) {
    return {endpoint: SCHNELL_ENDPOINT, jsonImage: true, textOnly: true,
      body: {model, prompt, response_format: 'b64_json', width: 512, height: 512, num_inference_steps: 4, guidance_scale: 0}};
  }
  return {endpoint: `https://router.huggingface.co/hf-inference/models/${model}`, jsonImage: false, textOnly: false,
    body: reference
      ? {inputs: reference, parameters: {prompt, guidance_scale: 7.5, num_inference_steps: 20, target_size: {width: 512, height: 512}}}
      : {inputs: prompt, parameters: {width: 512, height: 512, num_inference_steps: 20, guidance_scale: 7.5}}};
}
export const enhancedPrompt = (prompt: string) => `${prompt}, based on a vintage black and white photograph, maintaining the original composition and subject matter, high quality, detailed`;
