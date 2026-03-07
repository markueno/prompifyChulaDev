import { getSystemPrompt } from './prompts/prompts';
import optimized from './prompts/optimized';
import { getCodestralPrompt } from './prompts/codestral';

export interface PromptOptions {
  cwd: string;
  allowedHtmlElements: string[];
  modificationTagName: string;
  /** Custom prompt content when uploaded by user (used when promptId is 'custom') */
  customPrompt?: string;
}

export class PromptLibrary {
  static library: Record<
    string,
    {
      label: string;
      description: string;
      get: (options: PromptOptions) => string;
    }
  > = {
    default: {
      label: 'Default Prompt',
      description: 'This is the battle tested default system Prompt',
      get: options => getSystemPrompt(options.cwd),
    },
    optimized: {
      label: 'Optimized Prompt (experimental)',
      description: 'an Experimental version of the prompt for lower token usage',
      get: options => optimized(options),
    },
    codestral: {
      label: 'Codestral Optimized Prompt',
      description: 'Enhanced prompt specifically optimized for Codestral model with strict anti-placeholder rules',
      get: options => getCodestralPrompt(options.cwd),
    },
    custom: {
      label: 'Custom (uploaded)',
      description: 'Use your uploaded prompt template file',
      get: options => options.customPrompt ?? getSystemPrompt(options.cwd),
    },
  };
  static getList() {
    return Object.entries(this.library).map(([key, value]) => {
      const { label, description } = value;
      return {
        id: key,
        label,
        description,
      };
    });
  }
  static getPropmtFromLibrary(promptId: string, options: PromptOptions) {
    const prompt = this.library[promptId];

    if (!prompt) {
      throw 'Prompt Not Found';
    }

    return this.library[promptId]?.get(options);
  }
}
