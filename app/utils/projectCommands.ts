import type { Message } from 'ai';
import { generateId } from './fileUtils';

export interface ProjectCommands {
  type: string;
  setupCommand?: string;
  startCommand?: string;
  followupMessage: string;
}

interface FileContent {
  content: string;
  path: string;
}

export async function detectProjectCommands(files: FileContent[]): Promise<ProjectCommands> {
  const hasFile = (name: string) => files.some(f => f.path.endsWith(name));

  if (hasFile('package.json')) {
    const packageJsonFile = files.find(f => f.path.endsWith('package.json'));

    if (!packageJsonFile) {
      return { type: '', setupCommand: '', followupMessage: '' };
    }

    try {
      const packageJson = JSON.parse(packageJsonFile.content);
      const scripts = packageJson?.scripts || {};
      const dependencies = packageJson?.dependencies || {};
      const devDependencies = packageJson?.devDependencies || {};

      // Check for framework-specific dependencies and ensure CLI tools are available
      const frameworkCommands = getFrameworkCommands(dependencies, devDependencies);

      // Check for preferred commands in priority order
      const preferredCommands = ['dev', 'start', 'preview'];
      const availableCommand = preferredCommands.find(cmd => scripts[cmd]);

      if (availableCommand) {
        return {
          type: 'Node.js',
          setupCommand: `npm install && ${frameworkCommands.installCommand}`,
          startCommand: `npm run ${availableCommand}`,
          followupMessage: `Found "${availableCommand}" script in package.json. Running "npm run ${availableCommand}" after installation.`,
        };
      }

      return {
        type: 'Node.js',
        setupCommand: `npm install && ${frameworkCommands.installCommand}`,
        followupMessage:
          'Would you like me to inspect package.json to determine the available scripts for running this project?',
      };
    } catch (error) {
      console.error('Error parsing package.json:', error);
      return { type: '', setupCommand: '', followupMessage: '' };
    }
  }

  if (hasFile('index.html')) {
    return {
      type: 'Static',
      startCommand: 'npx --yes serve',
      followupMessage: '',
    };
  }

  return { type: '', setupCommand: '', followupMessage: '' };
}

function getFrameworkCommands(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>
): {
  installCommand: string;
} {
  const allDeps = { ...dependencies, ...devDependencies };

  /*
   * Framework-specific CLI tool installation commands
   * Install CLI tools locally and update package.json scripts to use npx
   */
  const frameworkCommands: Record<string, string> = {
    astro:
      'npm install astro@latest && npm pkg set scripts.dev="npx astro dev" && npm pkg set scripts.build="npx astro build"',
    next: 'npm install next@latest && npm pkg set scripts.dev="npx next dev" && npm pkg set scripts.build="npx next build"',
    remix:
      'npm install @remix-run/dev@latest && npm pkg set scripts.dev="npx remix vite:dev" && npm pkg set scripts.build="npx remix vite:build"',
    slidev: 'npm install slidev@latest && npm pkg set scripts.dev="npx slidev"',
    svelte: 'npm install svelte@latest && npm pkg set scripts.dev="npx svelte dev"',
    vue: 'npm install @vue/cli@latest && npm pkg set scripts.dev="npx vue-cli-service serve"',
    angular: 'npm install @angular/cli@latest && npm pkg set scripts.start="npx ng serve"',
    nuxt: 'npm install nuxi@latest && npm pkg set scripts.dev="npx nuxi dev"',
    qwik: 'npm install qwik@latest && npm pkg set scripts.dev="npx qwik dev"',
    solid: 'npm install solid@latest && npm pkg set scripts.dev="npx solid dev"',
    preact: 'npm install preact@latest && npm pkg set scripts.dev="npx preact dev"',
    vite: 'npm install vite@latest && npm pkg set scripts.dev="npx vite"',
  };

  // Check for framework dependencies and return appropriate install command
  for (const [framework, command] of Object.entries(frameworkCommands)) {
    if (allDeps[framework] || allDeps[`@${framework}/cli`] || allDeps[`@${framework}/core`]) {
      return { installCommand: command };
    }
  }

  // Default: just install dependencies
  return { installCommand: 'echo "Dependencies installed successfully"' };
}

export function createCommandsMessage(commands: ProjectCommands): Message | null {
  if (!commands.setupCommand && !commands.startCommand) {
    return null;
  }

  let commandString = '';

  if (commands.setupCommand) {
    commandString += `
<boltAction type="shell">${commands.setupCommand}</boltAction>`;
  }

  if (commands.startCommand) {
    commandString += `
<boltAction type="start">${commands.startCommand}</boltAction>
`;
  }

  return {
    role: 'assistant',
    content: `
<boltArtifact id="project-setup" title="Project Setup">
${commandString}
</boltArtifact>${commands.followupMessage ? `\n\n${commands.followupMessage}` : ''}`,
    id: generateId(),
    createdAt: new Date(),
  };
}

export function escapeBoltArtifactTags(input: string) {
  // Regular expression to match boltArtifact tags and their content
  const regex = /(<boltArtifact[^>]*>)([\s\S]*?)(<\/boltArtifact>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeBoltAActionTags(input: string) {
  // Regular expression to match boltArtifact tags and their content
  const regex = /(<boltAction[^>]*>)([\s\S]*?)(<\/boltAction>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeBoltTags(input: string) {
  return escapeBoltArtifactTags(escapeBoltAActionTags(input));
}
