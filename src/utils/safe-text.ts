const DEFAULT_MAX_LENGTH = 160;

export function clampDisplayText(value: unknown, maxLength = DEFAULT_MAX_LENGTH): string {
  const normalized =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
  const compact = normalized.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function setMetaLine(root: HTMLElement, strongLabel: string, segments: string[]): void {
  root.textContent = '';

  const strong = document.createElement('strong');
  strong.textContent = clampDisplayText(strongLabel, 80) || '-';
  root.append(strong);

  for (const segment of segments) {
    root.append(document.createTextNode(' · '));
    root.append(document.createTextNode(clampDisplayText(segment, 180) || '-'));
  }
}
