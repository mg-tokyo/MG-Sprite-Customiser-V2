const trackedBlobUrls = new Set<string>();

function isBlobUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.startsWith('blob:');
}

export function syncBlobUrlReferences(referenced: Iterable<string>): void {
  const next = new Set<string>();
  for (const value of referenced) {
    if (isBlobUrl(value)) next.add(value);
  }

  for (const existing of trackedBlobUrls) {
    if (!next.has(existing)) {
      try {
        URL.revokeObjectURL(existing);
      } catch {
        // Ignore revoke failures; stale URLs are harmless.
      }
      trackedBlobUrls.delete(existing);
    }
  }

  for (const value of next) trackedBlobUrls.add(value);
}
