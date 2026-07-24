import { json } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import JSZip from 'jszip';

/*
 * Server-side template fetcher (design mirrors upstream bolt.diy's api.github-template.ts).
 *
 * WHY: the old client-side importer called the GitHub Contents API once per directory and
 * once per file (~40 requests per template import) without authentication. GitHub allows 60
 * unauthenticated API requests per hour per IP, so one or two imports exhausted the quota and
 * every subsequent import failed with 403 → "Failed to import starter template" → the LLM
 * rebuilt everything from scratch (slow + token-hungry).
 *
 * HOW: download the whole repo as ONE zip archive and extract it in memory.
 *  1. codeload.github.com zip of the default branch — NOT governed by the API rate limit.
 *  2. api.github.com zipball (uses GITHUB_TOKEN / VITE_GITHUB_ACCESS_TOKEN when configured).
 *  3. latest release zipball (what upstream uses) as the final fallback.
 */

const ZIP_SOURCES = (repo: string): { url: string; api: boolean }[] => [
  { url: `https://codeload.github.com/${repo}/zip/HEAD`, api: false },
  { url: `https://codeload.github.com/${repo}/zip/refs/heads/main`, api: false },
  { url: `https://codeload.github.com/${repo}/zip/refs/heads/master`, api: false },
  { url: `https://api.github.com/repos/${repo}/zipball`, api: true },
];

interface TemplateFile {
  name: string;
  path: string;
  content: string;
}

async function fetchZip(url: string, useAuth: boolean, githubToken?: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'bolt.diy-app',
        ...(useAuth && githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

async function fetchLatestReleaseZip(repo: string, githubToken?: string): Promise<ArrayBuffer | null> {
  try {
    const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'bolt.diy-app',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    });

    if (!releaseResponse.ok) {
      return null;
    }

    const releaseData = (await releaseResponse.json()) as { zipball_url?: string };

    if (!releaseData.zipball_url) {
      return null;
    }

    return await fetchZip(releaseData.zipball_url, true, githubToken);
  } catch {
    return null;
  }
}

async function extractZip(zipArrayBuffer: ArrayBuffer): Promise<TemplateFile[]> {
  const zip = await JSZip.loadAsync(zipArrayBuffer);

  // GitHub zips wrap everything in a single "<repo>-<ref>/" root folder — strip it.
  let rootFolderName = '';
  zip.forEach(relativePath => {
    if (!rootFolderName && relativePath.includes('/')) {
      rootFolderName = relativePath.split('/')[0];
    }
  });

  const entries = await Promise.all(
    Object.keys(zip.files).map(async filename => {
      const zipEntry = zip.files[filename];

      if (zipEntry.dir || filename === rootFolderName) {
        return null;
      }

      let normalizedPath = filename;

      if (rootFolderName && filename.startsWith(rootFolderName + '/')) {
        normalizedPath = filename.substring(rootFolderName.length + 1);
      }

      if (!normalizedPath || normalizedPath.startsWith('.git/')) {
        return null;
      }

      const content = await zipEntry.async('string');

      return {
        name: normalizedPath.split('/').pop() || '',
        path: normalizedPath,
        content,
      };
    })
  );

  return entries.filter(Boolean) as TemplateFile[];
}

export async function loader({ request, context }: { request: Request; context: any }) {
  await requireAuth(request, context);

  const url = new URL(request.url);
  const repo = url.searchParams.get('repo');

  if (!repo) {
    return json({ error: 'Repository name is required' }, { status: 400 });
  }

  // "owner/repo" only — reject anything else before it reaches a URL we fetch.
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return json({ error: `Invalid repository name: ${repo} (expected "owner/repo")` }, { status: 400 });
  }

  const githubToken =
    context?.cloudflare?.env?.GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    (process.env.VITE_GITHUB_ACCESS_TOKEN && process.env.VITE_GITHUB_ACCESS_TOKEN.length > 10
      ? process.env.VITE_GITHUB_ACCESS_TOKEN
      : undefined);

  try {
    let zipArrayBuffer: ArrayBuffer | null = null;

    for (const source of ZIP_SOURCES(repo)) {
      zipArrayBuffer = await fetchZip(source.url, source.api, githubToken);

      if (zipArrayBuffer) {
        break;
      }
    }

    if (!zipArrayBuffer) {
      zipArrayBuffer = await fetchLatestReleaseZip(repo, githubToken);
    }

    if (!zipArrayBuffer) {
      return json(
        { error: `Could not download repository zip for "${repo}" (repo missing or unreachable)` },
        { status: 502 }
      );
    }

    const files = await extractZip(zipArrayBuffer);

    return json(files);
  } catch (error) {
    console.error('Error processing GitHub template:', repo, error);

    return json(
      {
        error: 'Failed to fetch template files',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
