export interface Budget {
  toolCalls: number;
  tokens: number;
}

/** In-process atomic meter. The production kernel does this in one SQLite transaction. Reserve is synchronous on purpose. */
export class BudgetMeter {
  private readonly left = new Map<string, Budget>();
  init(orderId: string, b: Budget): void {
    this.left.set(orderId, { ...b });
  }
  reserve(orderId: string, cost: Partial<Budget>): boolean {
    const cur = this.left.get(orderId);
    if (!cur) return false;
    const next = { toolCalls: cur.toolCalls - (cost.toolCalls ?? 0), tokens: cur.tokens - (cost.tokens ?? 0) };
    if (next.toolCalls < 0 || next.tokens < 0) return false;
    this.left.set(orderId, next);
    return true;
  }
  remaining(orderId: string): Budget | undefined {
    const b = this.left.get(orderId);
    return b ? { ...b } : undefined;
  }
}
