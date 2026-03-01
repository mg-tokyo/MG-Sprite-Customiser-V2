type Handler<T = unknown> = (data: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on<T>(event: string, handler: Handler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as Handler);
    return () => this.off(event, handler);
  }

  off<T>(event: string, handler: Handler<T>): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }

  emit<T>(event: string, data: T): void {
    this.handlers.get(event)?.forEach((h) => h(data));
  }
}

export const bus = new EventBus();

// Event name constants
export const Events = {
  SLOT_CHANGED: 'slot:changed',
  SLOT_SELECTED: 'slot:selected',
  SPRITE_LOADED: 'sprite:loaded',
  MUTATIONS_CHANGED: 'mutations:changed',
  RENDER_REQUEST: 'render:request',
  THEME_CHANGED: 'theme:changed',
  DATA_LOADED: 'data:loaded',
  EXPORT_REQUEST: 'export:request',
} as const;
