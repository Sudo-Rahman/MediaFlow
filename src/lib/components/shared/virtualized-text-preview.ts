export function splitTextPreviewLines(content: string): string[] {
  return content.replace(/\r\n?/g, '\n').split('\n');
}
