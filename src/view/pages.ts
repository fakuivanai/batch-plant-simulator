// The pages the build produces. Views link to each other through `pageFile`,
// so a link to a page that doesn't exist fails to compile.
export const pages = [
  { id: 'simulator', file: 'index.html', title: 'Batch plant simulator', entry: 'src/view/simulator/main.tsx' },
] as const;

export type PageId = (typeof pages)[number]['id'];

export function pageFile(id: PageId): string {
  const page = pages.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`No page ${id}`);
  return page.file;
}
