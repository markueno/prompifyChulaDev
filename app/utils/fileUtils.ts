import ignore from 'ignore';

// Common patterns to ignore, similar to .gitignore
export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
];

export const MAX_FILES = 1000;
export const ig = ignore().add(IGNORE_PATTERNS);

export const generateId = () => Math.random().toString(36).substring(2, 15);

export const isBinaryFile = async (file: File): Promise<boolean> => {
  const chunkSize = 1024;
  const buffer = new Uint8Array(await file.slice(0, chunkSize).arrayBuffer());

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];

    if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
      return true;
    }
  }

  return false;
};

export const shouldIncludeFile = (path: string): boolean => {
  return !ig.ignores(path);
};

const readPackageJson = async (files: File[]): Promise<{ 
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null> => {
  const packageJsonFile = files.find(f => f.webkitRelativePath.endsWith('package.json'));

  if (!packageJsonFile) {
    return null;
  }

  try {
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(packageJsonFile);
    });

    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading package.json:', error);
    return null;
  }
};

export const detectProjectType = async (
  files: File[]
): Promise<{ type: string; setupCommand: string; followupMessage: string }> => {
  const hasFile = (name: string) => files.some(f => f.webkitRelativePath.endsWith(name));

  if (hasFile('package.json')) {
    const packageJson = await readPackageJson(files);
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
        followupMessage: `Found "${availableCommand}" script in package.json. Running "npm run ${availableCommand}" after installation.`,
      };
    }

    return {
      type: 'Node.js',
      setupCommand: `npm install && ${frameworkCommands.installCommand}`,
      followupMessage:
        'Would you like me to inspect package.json to determine the available scripts for running this project?',
    };
  }

  if (hasFile('index.html')) {
    return {
      type: 'Static',
      setupCommand: 'npx --yes serve',
      followupMessage: '',
    };
  }

  return { type: '', setupCommand: '', followupMessage: '' };
};

function getFrameworkCommands(dependencies: Record<string, string>, devDependencies: Record<string, string>): {
  installCommand: string;
} {
  const allDeps = { ...dependencies, ...devDependencies };
  
  // Framework-specific CLI tool installation commands
  // Use npm to install CLI tools locally, then access them via node_modules/.bin
  const frameworkCommands: Record<string, string> = {
    'astro': 'npm install -g astro@latest && astro telemetry disable',
    'next': 'npm install -g next@latest && next telemetry disable',
    'remix': 'npm install -g @remix-run/cli@latest',
    'slidev': 'npm install -g slidev@latest',
    'svelte': 'npm install -g svelte@latest',
    'vue': 'npm install -g @vue/cli@latest',
    'angular': 'npm install -g @angular/cli@latest',
    'nuxt': 'npm install -g nuxi@latest',
    'qwik': 'npm install -g qwik@latest',
    'solid': 'npm install -g solid@latest',
    'preact': 'npm install -g preact@latest',
    'vite': 'npm install -g vite@latest',
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

export const filesToArtifacts = (files: { [path: string]: { content: string } }, id: string): string => {
  return `
<boltArtifact id="${id}" title="User Updated Files">
${Object.keys(files)
  .map(
    filePath => `
<boltAction type="file" filePath="${filePath}">
${files[filePath].content}
</boltAction>
`
  )
  .join('\n')}
</boltArtifact>
  `;
};
