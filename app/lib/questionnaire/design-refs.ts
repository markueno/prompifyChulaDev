// Eagerly imports all brand design-system markdown files at build time.
// Vite bundles these as raw strings — no runtime file I/O needed.
const modules = import.meta.glob('./design-refs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function brandKey(path: string): string {
  return path.replace('./design-refs/', '').replace('.md', '');
}

export const designSystems: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, content]) => [brandKey(path), content]),
);

export function getDesignSystem(brandId: string): string {
  return designSystems[brandId] ?? '';
}
