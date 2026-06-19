import * as fs from 'fs';
import * as path from 'path';

interface FolderMetadata {
  [sanitizedPath: string]: {
    originalName: string;
    driveId: string;
    path: string[];
  };
}

// Type matching Starlight's sidebar configuration
// Based on @astrojs/starlight/schemas/sidebar SidebarItem type
type SidebarItem = 
  | { label: string; link: string }  // Link item
  | { label: string; items: SidebarItem[]; collapsed?: boolean };  // Group item

/**
 * Loads folder metadata from sync process
 */
function loadFolderMetadata(): FolderMetadata {
  const metadataPath = path.join(process.cwd(), 'folder-metadata.json');
  
  if (!fs.existsSync(metadataPath)) {
    console.warn('⚠️  folder-metadata.json not found. Run `pnpm sync` first.');
    return {};
  }
  
  const content = fs.readFileSync(metadataPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Strips number prefix from folder/file names
 * e.g., "01-setup" -> "setup", "02-advanced" -> "advanced"
 */
function stripNumberPrefix(name: string): string {
  return name.replace(/^\d+-/, '');
}

/**
 * Extracts title from markdown frontmatter
 */
function getTitleFromFrontmatter(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const titleMatch = frontmatter.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      
      if (titleMatch) {
        return stripNumberPrefix(titleMatch[1].replace(/^["']|["']$/g, ''));
      }
    }
  } catch (error) {
    // If we can't read the file, return null
  }
  
  return null;
}

/**
 * Gets label for a file/folder from metadata or filename
 */
function getLabel(sanitizedPath: string, sanitizedName: string, metadata: FolderMetadata): string {
  // Check if we have metadata for this path
  const meta = metadata[sanitizedPath];
  if (meta) {
    return stripNumberPrefix(meta.originalName);
  }
  
  // Fallback to sanitized name with number prefix stripped
  return stripNumberPrefix(sanitizedName);
}

/**
 * Recursively builds sidebar structure for a directory
 */
function buildSidebarForDirectory(
  dirPath: string,
  relativePath: string,
  metadata: FolderMetadata
): SidebarItem[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items: SidebarItem[] = [];

  // Separate folders and files
  const folders = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  const files = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name).sort();

  // Process folders first
  for (const folder of folders) {
    const folderPath = path.join(dirPath, folder);
    const folderRelativePath = relativePath ? `${relativePath}/${folder}` : folder;
    
    const label = getLabel(folderRelativePath, folder, metadata);

    // Build items for this folder
    const childItems = buildSidebarForDirectory(folderPath, folderRelativePath, metadata);

    if (childItems.length > 0) {
      // Folder has children - create collapsible group
      items.push({
        label,
        collapsed: true,
        items: childItems,
      });
    }
  }

  // Process markdown files
  for (const file of files) {
    const fileName = file.replace(/\.md$/, '');
    
    // Skip the top-level index.md (homepage)
    if (relativePath === '' && fileName === 'index') continue;
    
    const fileRelativePath = relativePath ? `${relativePath}/${fileName}` : fileName;
    const filePath = path.join(dirPath, file);
    
    // Try to get title from frontmatter, fallback to filename with number prefix stripped
    const title = getTitleFromFrontmatter(filePath);
    const label = title || stripNumberPrefix(fileName);

    const item = {
      label,
      link: fileRelativePath,
    };
    // If item matches folder name, show first (parent files). This only works 1 level down but fine for us.
    if(fileName === relativePath){
      items.unshift(item)
    } else if (relativePath !== '' && (fileName.includes('omelessness') || fileName.includes('hecklist'))) { 
      // Manually setting a few second items as a high priority
      items.splice(1, 0, item)
    } else {
    items.push(item);
  }

  }

  return items;
}

/**
 * Generates Starlight sidebar config from docs directory
 */
export function generateSidebar() {
  const docsDir = path.join(process.cwd(), 'src', 'content', 'docs');
  
  if (!fs.existsSync(docsDir)) {
    return [];
  }

  // Load folder metadata to get original Drive names
  const metadata = loadFolderMetadata();

  // Build sidebar recursively from the docs directory
  return buildSidebarForDirectory(docsDir, '', metadata);
}
