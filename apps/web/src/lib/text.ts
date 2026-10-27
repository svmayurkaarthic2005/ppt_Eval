/** Truncates at the last whitespace within maxLen so words are never cut
 * mid-word -- a hard slice(0, maxLen) would otherwise chop "qualitative"
 * down to "qualitative as". */
export function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "...";
}
