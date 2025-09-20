import { LLMManager } from '~/lib/modules/llm/manager';
import type { Template } from '~/types/template';

// Generate a unique workdir name for each browser session
const generateUniqueWorkdirName = () => {
  // Use sessionStorage to maintain the same ID within a browser session
  if (typeof window !== 'undefined' && window.sessionStorage) {
    let sessionId = window.sessionStorage.getItem('bolt-session-id');
    if (!sessionId) {
      sessionId = Math.random().toString(36).substring(2, 15);
      window.sessionStorage.setItem('bolt-session-id', sessionId);
    }
    return `project-${sessionId}`;
  }
  // Fallback for SSR or when sessionStorage is not available
  return `project-${Math.random().toString(36).substring(2, 15)}`;
};

export const WORK_DIR_NAME = generateUniqueWorkdirName();
export const WORK_DIR = `/home/${WORK_DIR_NAME}`;
export const MODIFICATIONS_TAG_NAME = 'bolt_file_modifications';
export const MODEL_REGEX = /^\[Model: (.*?)\]\n\n/;
export const PROVIDER_REGEX = /\[Provider: (.*?)\]\n\n/;
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const PROMPT_COOKIE_KEY = 'cachedPrompt';
export const DISABLE_DYNAMIC_MODELS = 'DISABLE_DYNAMIC_MODELS';

// Environment variable utilities for individual button controls
export const isImportChatHidden = (): boolean => {
  const hideButton = import.meta.env.VITE_HIDE_IMPORT_CHAT;
  return hideButton === 'true' || hideButton === '1';
};

export const isImportFolderHidden = (): boolean => {
  const hideButton = import.meta.env.VITE_HIDE_IMPORT_FOLDER;
  return hideButton === 'true' || hideButton === '1';
};

export const isGitCloneHidden = (): boolean => {
  const hideButton = import.meta.env.VITE_HIDE_GIT_CLONE;
  return hideButton === 'true' || hideButton === '1';
};

// Legacy function for backward compatibility
export const isImportButtonsHidden = (): boolean => {
  // Check for the VITE_HIDE_IMPORT_BUTTONS environment variable
  const hideButtons = import.meta.env.VITE_HIDE_IMPORT_BUTTONS;
  return hideButtons === 'true' || hideButtons === '1';
};

const llmManager = LLMManager.getInstance(import.meta.env);

export const PROVIDER_LIST = llmManager.getAllProviders();
export const DEFAULT_PROVIDER = llmManager.getDefaultProvider();

export const providerBaseUrlEnvKeys: Record<string, { baseUrlKey?: string; apiTokenKey?: string }> = {};
PROVIDER_LIST.forEach(provider => {
  providerBaseUrlEnvKeys[provider.name] = {
    baseUrlKey: provider.config.baseUrlKey,
    apiTokenKey: provider.config.apiTokenKey,
  };
});

// starter Templates

export const STARTER_TEMPLATES: Template[] = [
  {
    name: 'bolt-astro-basic',
    label: 'Astro Basic',
    description: 'Lightweight Astro starter template for building fast static websites',
    githubRepo: 'thecodacus/bolt-astro-basic-template',
    tags: ['astro', 'blog', 'performance'],
    icon: 'i-bolt:astro',
  },
  {
    name: 'bolt-nextjs-shadcn',
    label: 'Next.js with shadcn/ui',
    description: 'Next.js starter fullstack template integrated with shadcn/ui components and styling system',
    githubRepo: 'thecodacus/bolt-nextjs-shadcn-template',
    tags: ['nextjs', 'react', 'typescript', 'shadcn', 'tailwind'],
    icon: 'i-bolt:nextjs',
  },
  {
    name: 'bolt-qwik-ts',
    label: 'Qwik TypeScript',
    description: 'Qwik framework starter with TypeScript for building resumable applications',
    githubRepo: 'thecodacus/bolt-qwik-ts-template',
    tags: ['qwik', 'typescript', 'performance', 'resumable'],
    icon: 'i-bolt:qwik',
  },
  {
    name: 'bolt-remix-ts',
    label: 'Remix TypeScript',
    description: 'Remix framework starter with TypeScript for full-stack web applications',
    githubRepo: 'thecodacus/bolt-remix-ts-template',
    tags: ['remix', 'typescript', 'fullstack', 'react'],
    icon: 'i-bolt:remix',
  },
  {
    name: 'bolt-slidev',
    label: 'Slidev Presentation',
    description: 'Slidev starter template for creating developer-friendly presentations using Markdown',
    githubRepo: 'thecodacus/bolt-slidev-template',
    tags: ['slidev', 'presentation', 'markdown'],
    icon: 'i-bolt:slidev',
  },
  {
    name: 'bolt-sveltekit',
    label: 'SvelteKit',
    description: 'SvelteKit starter template for building fast, efficient web applications',
    githubRepo: 'bolt-sveltekit-template',
    tags: ['svelte', 'sveltekit', 'typescript'],
    icon: 'i-bolt:svelte',
  },
  {
    name: 'vanilla-vite',
    label: 'Vanilla + Vite',
    description: 'Minimal Vite starter template for vanilla JavaScript projects',
    githubRepo: 'thecodacus/vanilla-vite-template',
    tags: ['vite', 'vanilla-js', 'minimal'],
    icon: 'i-bolt:vite',
  },
  {
    name: 'bolt-vite-react',
    label: 'React + Vite + typescript',
    description: 'React starter template powered by Vite for fast development experience',
    githubRepo: 'thecodacus/bolt-vite-react-ts-template',
    tags: ['react', 'vite', 'frontend'],
    icon: 'i-bolt:react',
  },
  {
    name: 'bolt-vite-ts',
    label: 'Vite + TypeScript',
    description: 'Vite starter template with TypeScript configuration for type-safe development',
    githubRepo: 'thecodacus/bolt-vite-ts-template',
    tags: ['vite', 'typescript', 'minimal'],
    icon: 'i-bolt:typescript',
  },
  {
    name: 'bolt-vue',
    label: 'Vue.js',
    description: 'Vue.js starter template with modern tooling and best practices',
    githubRepo: 'thecodacus/bolt-vue-template',
    tags: ['vue', 'typescript', 'frontend'],
    icon: 'i-bolt:vue',
  },
  {
    name: 'bolt-angular',
    label: 'Angular Starter',
    description: 'A modern Angular starter template with TypeScript support and best practices configuration',
    githubRepo: 'thecodacus/bolt-angular-template',
    tags: ['angular', 'typescript', 'frontend', 'spa'],
    icon: 'i-bolt:angular',
  },
];
