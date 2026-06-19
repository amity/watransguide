import { NodeHtmlMarkdown } from 'node-html-markdown';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { ensureDirectoryExists, getImageUrlForMarkdown } from './path-utils';

export interface ConversionResult {
  markdown: string;
  imageCount: number;
}

export interface ConversionOptions {
  fileId: string;
  fileName: string;
  html: string;
  imageDir: string;  // Directory to save images (relative to public/images/)
  author?: string;
  modifiedTime: string;
  fileIdToPath?: Map<string, string>;  // Mapping of Drive file IDs to wiki paths
}

export interface MarkdownConversionOptions {
  fileId: string;
  fileName: string;
  markdown: string;
  html?: string;  // Optional HTML for high-quality images
  imageDir: string;  // Directory to save images (relative to public/images/)
  author?: string;
  modifiedTime: string;
  fileIdToPath?: Map<string, string>;  // Mapping of Drive file IDs to wiki paths
}

/**
 * Converts Google Docs HTML to Markdown with frontmatter
 */
export async function convertDocToMarkdown(
  options: ConversionOptions
): Promise<ConversionResult> {
  const { html, fileName, imageDir, author, modifiedTime, fileId, fileIdToPath } = options;

  // Parse HTML
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Extract and download images
  const imageCount = await processImages(document, imageDir);

  // Convert HTML to Markdown
  const nhm = new NodeHtmlMarkdown();
  const bodyHtml = document.body.innerHTML;
  let markdown = nhm.translate(bodyHtml);

  // Clean up markdown
  markdown = cleanupMarkdown(markdown);

  // Replace Google Drive links with wiki paths
  if (fileIdToPath) {
    markdown = replaceDriveLinks(markdown, fileIdToPath);
  }

  // Remove duplicate title from first line if it matches
  markdown = removeDuplicateTitle(markdown, fileName);

  // Generate frontmatter
  const frontmatter = generateFrontmatter({
    title: fileName,
    author,
    modifiedTime,
    fileId,
  });

  // Combine frontmatter and markdown
  const fullMarkdown = `${frontmatter}\n${markdown}`;

  return {
    markdown: fullMarkdown,
    imageCount,
  };
}

/**
 * Processes images in the HTML document
 * Downloads them and updates src attributes to local paths
 */
async function processImages(
  document: Document,
  imageDir: string
): Promise<number> {
  const images = document.querySelectorAll('img');
  let imageCount = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const src = img.getAttribute('src');

    if (!src) continue;

    try {
      // Google Docs images are typically embedded as data URLs or served from googleusercontent.com
      if (src.startsWith('data:')) {
        // Handle data URLs (base64 encoded images)
        const ext = await saveDataUrlImage(src, imageDir, i);
        const imageUrl = getImageUrlForMarkdown(`${imageDir}/image-${i}.${ext}`);
        img.setAttribute('src', imageUrl);
        imageCount++;
      } else if (src.includes('googleusercontent.com') || src.startsWith('http')) {
        // Handle external URLs
        await downloadImage(src, imageDir, i);
        const ext = getImageExtension(src);
        const imageUrl = getImageUrlForMarkdown(`${imageDir}/image-${i}.${ext}`);
        img.setAttribute('src', imageUrl);
        imageCount++;
      }
    } catch (error) {
      console.warn(`⚠️  Failed to process image ${i}:`, error);
      // Keep original src, will result in broken link
    }
  }

  return imageCount;
}

/**
 * Saves a data URL image to the filesystem
 * Made public for reuse in markdown conversion
 */
export async function saveDataUrlImage(
  dataUrl: string,
  imageDir: string,
  index: number
): Promise<string> {
  const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid data URL format');
  }

  const ext = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');

  const imagePath = path.join(
    process.cwd(),
    'public',
    'images',
    imageDir,
    `image-${index}.${ext}`
  );

  ensureDirectoryExists(imagePath);
  fs.writeFileSync(imagePath, buffer);
  return ext;
}

/**
 * Downloads an image from a URL
 */
async function downloadImage(
  url: string,
  imageDir: string,
  index: number
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const ext = getImageExtension(url);

  const imagePath = path.join(
    process.cwd(),
    'public',
    'images',
    imageDir,
    `image-${index}.${ext}`
  );

  ensureDirectoryExists(imagePath);
  fs.writeFileSync(imagePath, Buffer.from(buffer));
}

/**
 * Gets image extension from URL or defaults to png
 */
function getImageExtension(url: string): string {
  const match = url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i);
  return match ? match[1].toLowerCase() : 'png';
}

/**
 * Cleans up the converted markdown
 */
function cleanupMarkdown(markdown: string): string {
  return markdown
    .replace(/\n{3,}/g, '\n\n')  // Collapse multiple newlines
    .replace(/ {#.*}/g, '')
    .trim();
}

/**
 * Replaces Google Drive document links with wiki paths
 */
function replaceDriveLinks(markdown: string, fileIdToPath: Map<string, string>): string {
  // Pattern to match Google Docs URLs (with all the google.com/url redirect nonsense)
  // Captures the file ID from URLs like:
  // - https://docs.google.com/document/d/{fileId}/edit
  // - https://docs.google.com/document/u/0/d/{fileId}/edit
  // - https://www.google.com/url?q=https://docs.google.com/document/u/0/d/{fileId}/edit&sa=...
  
  return markdown.replace(
    /\[([^\]]+)\]\((https:\/\/www\.google\.com\/url\?q=)?(https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_%-]+)\/[^)]*)\)/g,
    (match, linkText, redirectPrefix, fullUrl, encodedFileId) => {
      // Decode URL-encoded file ID (e.g., %5F -> _)
      const fileId = decodeURIComponent(encodedFileId);
      
      // Check if this file ID is in our wiki
      const wikiPath = fileIdToPath.get(fileId);
      
      // Checklists are weird, needs manual tweaking so we want to link them in GDocs not wiki.
      if (wikiPath && !linkText.includes("Checklist") && !linkText.includes("Template")) {
        // Convert to relative wiki link (remove .md extension for Astro/Starlight)
        const relativePath = wikiPath.replace(/\.md$/, '');
        console.log(`    🔗 Replacing Drive link to "${linkText}" with /${relativePath}`);
        return `[${linkText}](/${relativePath})`;
      }
      
      // If not in our wiki, keep the original link but clean up the redirect
      if (redirectPrefix) {
        // Remove the google.com/url redirect wrapper
        return `[${linkText}](${fullUrl})`;
      }
      
      return match; // Keep original if no changes needed
    }
  );
}

/**
 * Strips number prefix from file/folder names
 * e.g., "01-Setup" -> "Setup", "02-Advanced" -> "Advanced"
 */
function stripNumberPrefixAndFormatting(name: string): string {
  return name.replace(/^\d+-/, '').replace(/^[*#\s]+|[*#\s]+$/g, '');
}

function isDuplicateOrEmpty(line: string, title: string) {
  const trimmed = stripNumberPrefixAndFormatting(line).trim();
  return trimmed.length == 0 || 
    trimmed.toLowerCase() == title.toLowerCase() || 
    trimmed.toLowerCase() == 'tab 1';
}

/**
 * Removes duplicate title from first line if it matches the document title
 */
function removeDuplicateTitle(markdown: string, fileName: string): string {
  const lines = markdown.split('\n');
  if (lines.length === 0) return markdown;

  const cleanTitle = stripNumberPrefixAndFormatting(fileName);

  // If line matches title, or is "tab 1" or empty, remove it. Continue until false. 
  if(isDuplicateOrEmpty(lines[0], cleanTitle)){
    lines.shift();
    while(isDuplicateOrEmpty(lines[0], cleanTitle)){
      lines.shift();
    }
    return lines.join('\n').trim();
  }
  return markdown;
}

/**
 * Generates YAML frontmatter
 */
function generateFrontmatter(options: {
  title: string;
  author?: string;
  modifiedTime: string;
  fileId: string;
}): string {
  const lines = ['---'];
  // Strip number prefix from title for display
  const cleanTitle = stripNumberPrefixAndFormatting(options.title);
  lines.push(`title: "${escapeFrontmatterString(cleanTitle)}"`);
  
  if (options.author) {
    lines.push(`author: "${escapeFrontmatterString(options.author)}"`);
  }
  
  lines.push(`lastModified: ${options.modifiedTime}`);
  lines.push(`lastUpdated: ${options.modifiedTime}`);
  lines.push(`driveFileId: "${options.fileId}"`);
  lines.push('---');
  
  return lines.join('\n');
}

/**
 * Escapes quotes in frontmatter strings
 */
function escapeFrontmatterString(str: string): string {
  return str.replace(/"/g, '\\"');
}

/**
 * Converts Google Docs Markdown export to cleaned Markdown with frontmatter
 * Processes base64 image references and replaces them with local paths
 * If HTML is provided, uses higher-quality images from HTML instead of markdown
 */
export async function convertMarkdownDoc(
  options: MarkdownConversionOptions
): Promise<ConversionResult> {
  const { markdown, html, fileName, imageDir, author, modifiedTime, fileId, fileIdToPath } = options;

  let processedMarkdown = markdown;
  let imageCount = 0;

  // If HTML is provided, extract high-quality images from it
  let htmlImages: string[] = [];
  if (html) {
    const dom = new JSDOM(html);
    const images = dom.window.document.querySelectorAll('img');
    htmlImages = Array.from(images).map(img => img.getAttribute('src') || '');
  }

  // Pattern to find image reference definitions: [imageN]: <data:image/...>
  // Google Docs markdown export uses this format for images
  const imageRefPattern = /\[image(\d+)\]:\s*<data:image\/(\w+);base64,([^>]+)>/g;
  const imageReplacements = new Map<string, string>();

  // Extract and save all images
  let match;
  let imageIndex = 0;
  while ((match = imageRefPattern.exec(markdown)) !== null) {
    const imageNum = match[1];
    const mdExt = match[2]; // Extension from markdown
    const base64Data = match[3];
    
    // Use HTML image if available (higher quality), otherwise use markdown image
    let dataUrl: string;
    let ext: string;
    
    if (htmlImages[imageIndex] && htmlImages[imageIndex].startsWith('data:')) {
      dataUrl = htmlImages[imageIndex];
      // Extract extension from HTML data URL
      const htmlExtMatch = dataUrl.match(/^data:image\/(\w+);base64,/);
      ext = htmlExtMatch ? htmlExtMatch[1] : mdExt;
    } else {
      dataUrl = `data:image/${mdExt};base64,${base64Data}`;
      ext = mdExt;
    }
    
    try {
      // Save the image using the same index from the markdown
      const imgIndex = parseInt(imageNum) - 1; // Convert 1-based to 0-based
      await saveDataUrlImage(dataUrl, imageDir, imgIndex);
      
      // Generate the local image path for markdown
      const imageUrl = getImageUrlForMarkdown(`${imageDir}/image-${imgIndex}.${ext}`);
      imageReplacements.set(`image${imageNum}`, imageUrl);
      imageCount++;
    } catch (error) {
      console.warn(`⚠️  Failed to process image${imageNum}:`, error);
    }
    
    imageIndex++;
  }

  // Remove all image reference definitions from the markdown
  processedMarkdown = processedMarkdown.replace(/\[image\d+\]:\s*<data:image\/\w+;base64,[^>]+>\n?/g, '');

  // Replace image references in the text: ![alt text][imageN] -> ![](/images/path)
  // This matches both with and without alt text: ![][imageN] and ![alt][imageN]
  for (const [imageName, imagePath] of imageReplacements.entries()) {
    const refPattern = new RegExp(`!\\[[^\\]]*\\]\\[${imageName}\\]`, 'g');
    processedMarkdown = processedMarkdown.replace(refPattern, `![](${imagePath})`);
  }

  // Replace Google Drive links with wiki paths
  if (fileIdToPath) {
    processedMarkdown = replaceDriveLinks(processedMarkdown, fileIdToPath);
  }

  // Remove duplicate title from first line if it matches
  processedMarkdown = removeDuplicateTitle(processedMarkdown, fileName);

  // Clean up markdown
  processedMarkdown = cleanupMarkdown(processedMarkdown);

  // Generate frontmatter
  const frontmatter = generateFrontmatter({
    title: fileName,
    author,
    modifiedTime,
    fileId,
  });

  // Combine frontmatter and markdown
  const fullMarkdown = `${frontmatter}\n${processedMarkdown}`;

  return {
    markdown: fullMarkdown,
    imageCount,
  };
}
