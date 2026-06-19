import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

/**
 * Generates redirects from Google Drive file IDs to wiki paths
 * Format: /{driveFileId} -> /path/to/page
 */
export function generateRedirects(): Record<string, string> {
  const redirects: Record<string, string> = {'/': '/home'};
  const docsDir = path.join(process.cwd(), 'src', 'content', 'docs');

  if (!fs.existsSync(docsDir)) {
    return redirects;
  }

  // Recursively scan all markdown files
  scanDirectory(docsDir, docsDir, redirects);

  return redirects;
}

/**
 * Recursively scans a directory for markdown files and extracts Drive file IDs
 */
function scanDirectory(dir: string, baseDir: string, redirects: Record<string, string>) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Recursively scan subdirectories
      scanDirectory(fullPath, baseDir, redirects);
    } else if (item.endsWith('.md')) {
      // Parse markdown frontmatter
      const content = fs.readFileSync(fullPath, 'utf8');
      const { data } = matter(content);

      if (data.driveFileId) {
        // Get relative path from docs directory
        const relativePath = path.relative(baseDir, fullPath);
        // Remove .md extension and convert to web path
        const webPath = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');
        
        // Add redirect from Drive file ID to web path
        redirects[`/${data.driveFileId}`] = webPath;
      }
    }
  }
}
