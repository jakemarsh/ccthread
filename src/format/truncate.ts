export function truncateLines(text: string, maxLines: number): { body: string; hiddenLines: number } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { body: text, hiddenLines: 0 };
  return { body: lines.slice(0, maxLines).join("\n"), hiddenLines: lines.length - maxLines };
}

export function describeImage(mediaType: string, base64: string): string {
  // base64 length ≈ 4/3 of original. Close enough for a label.
  const bytes = Math.floor((base64.length * 3) / 4);
  const kb = bytes / 1024;
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  return `[image: ${mediaType}, ${size}]`;
}

export function softWrap(text: string, width = 100): string {
  return text.split("\n").map(l => {
    if (l.length <= width) return l;
    const out: string[] = [];
    let s = l;
    while (s.length > width) {
      let cut = s.lastIndexOf(" ", width);
      if (cut < 40) cut = width;
      out.push(s.slice(0, cut));
      s = s.slice(cut).trimStart();
    }
    if (s) out.push(s);
    return out.join("\n");
  }).join("\n");
}
