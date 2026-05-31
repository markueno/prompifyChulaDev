import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import useViewport from '~/lib/hooks';
import { chatStore } from '~/lib/stores/chat';
import { netlifyConnection } from '~/lib/stores/netlify';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { classNames } from '~/utils/classNames';
import { path } from '~/utils/path';
import { useEffect, useRef, useState } from 'react';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';
import { chatId } from '~/lib/persistence/useChatHistory'; // Add this import
import { streamingState } from '~/lib/stores/streaming';
import { NetlifyDeploymentLink } from '~/components/chat/NetlifyDeploymentLink.client';

interface HeaderActionButtonsProps {}

export function HeaderActionButtons({}: HeaderActionButtonsProps) {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const { showChat } = useStore(chatStore);
  const connection = useStore(netlifyConnection);
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];
  const [isDeploying, setIsDeploying] = useState(false);
  const isSmallViewport = useViewport(1024);
  const canHideChat = showWorkbench || !showChat;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isStreaming = useStore(streamingState);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentChatId = useStore(chatId);

  const handleDeploy = async () => {
    if (!connection.user || !connection.token) {
      toast.error('Please connect to Netlify first in the settings tab!');
      return;
    }

    if (!currentChatId) {
      toast.error('No active chat found');
      return;
    }

    try {
      setIsDeploying(true);

      const artifact = workbenchStore.firstArtifact;

      if (!artifact) {
        throw new Error('No active project found');
      }

      const actionId = 'build-' + Date.now();
      const actionData: ActionCallbackData = {
        messageId: 'netlify build',
        artifactId: artifact.id,
        actionId,
        action: {
          type: 'build' as const,
          content: 'npm run build',
        },
      };

      // Add the action first
      artifact.runner.addAction(actionData);

      // Then run it
      await artifact.runner.runAction(actionData);

      if (!artifact.runner.buildOutput) {
        throw new Error('Build failed');
      }

      // Get the build files
      const container = await webcontainer;

      // Get the build path and ensure it's properly formatted
      const buildPath = artifact.runner.buildOutput.path;

      console.log('[Deploy] Build path:', buildPath);
      console.log('[Deploy] Build output:', artifact.runner.buildOutput);

      // Check if the build path exists and is accessible
      try {
        // Extract the relative path from the build path for webcontainer access
        const relativeBuildPath = buildPath.replace(container.workdir, '').replace(/^\/+/, '') || '.';
        console.log('[Deploy] Relative build path for webcontainer:', relativeBuildPath);

        const buildDirContents = await container.fs.readdir(relativeBuildPath, { withFileTypes: true });
        console.log(
          '[Deploy] Build directory contents:',
          buildDirContents.map(entry => entry.name)
        );
      } catch (error) {
        console.error('[Deploy] Build path not accessible:', buildPath, error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Build directory not found: ${buildPath}. Error: ${errorMessage}`);
      }

      // Get all files recursively
      async function getAllFiles(dirPath: string): Promise<Record<string, string>> {
        const files: Record<string, string> = {};

        try {
          // Convert absolute path to relative path for webcontainer
          const relativeDirPath = dirPath.replace(container.workdir, '').replace(/^\/+/, '') || '.';
          console.log('[Deploy] Reading directory (relative):', relativeDirPath);

          const entries = await container.fs.readdir(relativeDirPath, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isFile()) {
              try {
                // Use relative path for webcontainer file reading
                const relativeFilePath = path.join(relativeDirPath, entry.name);
                const content = await container.fs.readFile(relativeFilePath, 'utf-8');

                /*
                 * Create a clean deployment path by removing the build directory prefix
                 * and ensuring it starts with a forward slash for Netlify
                 */
                let deployPath = fullPath.replace(buildPath, '');

                if (!deployPath.startsWith('/')) {
                  deployPath = '/' + deployPath;
                }

                console.log('[Deploy] File path mapping:', fullPath, '->', deployPath);
                files[deployPath] = content;
              } catch (error) {
                console.error('[Deploy] Failed to read file:', fullPath, error);
                // Continue with other files instead of failing completely
              }
            } else if (entry.isDirectory()) {
              const subFiles = await getAllFiles(fullPath);
              Object.assign(files, subFiles);
            }
          }
        } catch (error) {
          console.error('[Deploy] Failed to read directory:', dirPath, error);
        }

        return files;
      }

      const fileContents = await getAllFiles(buildPath);

      console.log('[Deploy] Total files to deploy:', Object.keys(fileContents).length);
      console.log('[Deploy] File paths:', Object.keys(fileContents).slice(0, 10)); // Log first 10 file paths

      // Use chatId instead of artifact.id
      const existingSiteId = localStorage.getItem(`netlify-site-${currentChatId}`);

      // Deploy using the API route with file contents
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          siteId: existingSiteId || undefined,
          files: fileContents,
          token: connection.token,
          chatId: currentChatId, // Use chatId instead of artifact.id
        }),
      });

      const data = (await response.json()) as any;

      if (!response.ok || !data.deploy || !data.site) {
        console.error('Invalid deploy response:', data);
        throw new Error(data.error || 'Invalid deployment response');
      }

      // Poll for deployment status
      const maxAttempts = 20; // 2 minutes timeout
      let attempts = 0;
      let deploymentStatus;

      while (attempts < maxAttempts) {
        try {
          const statusResponse = await fetch(
            `https://api.netlify.com/api/v1/sites/${data.site.id}/deploys/${data.deploy.id}`,
            {
              headers: {
                Authorization: `Bearer ${connection.token}`,
              },
            }
          );

          deploymentStatus = (await statusResponse.json()) as any;

          if (deploymentStatus.state === 'ready' || deploymentStatus.state === 'uploaded') {
            break;
          }

          if (deploymentStatus.state === 'error') {
            throw new Error('Deployment failed: ' + (deploymentStatus.error_message || 'Unknown error'));
          }

          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error('Status check error:', error);
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (attempts >= maxAttempts) {
        throw new Error('Deployment timed out');
      }

      // Store the site ID if it's a new site
      if (data.site) {
        localStorage.setItem(`netlify-site-${currentChatId}`, data.site.id);
      }

      toast.success(
        <div>
          Deployed successfully!{' '}
          <a
            href={deploymentStatus.ssl_url || deploymentStatus.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View site
          </a>
        </div>
      );
    } catch (error) {
      console.error('Deploy error:', error);
      toast.error(error instanceof Error ? error.message : 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="flex">
      <div className="relative z-[2000]" ref={dropdownRef}>
        <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden mr-2 text-sm">
          <Button
            active
            disabled={isDeploying || !activePreview || isStreaming}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="px-4 hover:bg-gray-50 flex items-center gap-2"
          >
            {isDeploying ? 'Deploying...' : 'Deploy'}
            <div
              className={classNames(
                'i-ph:caret-down w-4 h-4 transition-transform text-inherit',
                isDropdownOpen ? 'rotate-180' : ''
              )}
            />
          </Button>
        </div>

        {isDropdownOpen && (
          <div className="absolute right-2 flex flex-col gap-1 z-[2100] p-1 mt-1 min-w-[13.5rem] bg-bolt-elements-background-depth-2 rounded-md shadow-lg bg-bolt-elements-backgroundDefault border border-bolt-elements-borderColor">
            <Button
              active
              onClick={() => {
                handleDeploy();
                setIsDropdownOpen(false);
              }}
              disabled={isDeploying || !activePreview || !connection.user}
              className="flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative"
            >
              <img
                className="w-5 h-5"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/netlify"
              />
              <span className="mx-auto">{!connection.user ? 'No Account Connected' : 'Deploy to Netlify'}</span>
              {connection.user && <NetlifyDeploymentLink />}
            </Button>
            <Button
              active={false}
              disabled
              className="flex items-center w-full rounded-md px-4 py-2 text-sm text-bolt-elements-textTertiary gap-2"
            >
              <span className="sr-only">Coming Soon</span>
              <img
                className="w-5 h-5 bg-black p-1 rounded"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/vercel/white"
                alt="vercel"
              />
              <span className="mx-auto">Deploy to Vercel (Coming Soon)</span>
            </Button>
            <Button
              active={false}
              disabled
              className="flex items-center w-full rounded-md px-4 py-2 text-sm text-bolt-elements-textTertiary gap-2"
            >
              <span className="sr-only">Coming Soon</span>
              <img
                className="w-5 h-5"
                height="24"
                width="24"
                crossOrigin="anonymous"
                src="https://cdn.simpleicons.org/cloudflare"
                alt="vercel"
              />
              <span className="mx-auto">Deploy to Cloudflare (Coming Soon)</span>
            </Button>
          </div>
        )}
      </div>
      <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden">
        <Button
          active={showChat}
          disabled={!canHideChat || isSmallViewport} // expand button is disabled on mobile as it's not needed
          onClick={() => {
            if (canHideChat) {
              chatStore.setKey('showChat', !showChat);
            }
          }}
        >
          <div className="i-bolt:chat text-sm" />
        </Button>
        <div className="w-[1px] bg-bolt-elements-borderColor" />
        <Button
          active={showWorkbench}
          onClick={() => {
            if (showWorkbench && !showChat) {
              chatStore.setKey('showChat', true);
            }

            workbenchStore.showWorkbench.set(!showWorkbench);
          }}
        >
          <div className="i-ph:code-bold" />
        </Button>
      </div>
    </div>
  );
}

interface ButtonProps {
  active?: boolean;
  disabled?: boolean;
  children?: any;
  onClick?: VoidFunction;
  className?: string;
}

function Button({ active = false, disabled = false, children, onClick, className }: ButtonProps) {
  return (
    <button
      className={classNames(
        'flex items-center p-1.5',
        {
          'bg-white hover:bg-gray-50 text-zinc-900 hover:text-black': !active && !disabled,
          'bg-white text-zinc-900': active && !disabled,
          'bg-white text-zinc-400 cursor-not-allowed': disabled,
        },
        className
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
