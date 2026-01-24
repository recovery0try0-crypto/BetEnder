import { Quote } from '../../domain/pricing';

const CACHE_TTL = 10000; // 10 seconds

interface CacheEntry {
  quote: Quote;
  timestamp: number;
}

export class CacheService {
  private cache: Map<string, CacheEntry> = new Map();

  public getQuote(key: string): Quote | null {
    const entry = this.cache.get(key);

    if (entry && (Date.now() - entry.timestamp < CACHE_TTL)) {
      console.log(`Cache: Hit for key: ${key}`);
      return entry.quote;
    }

    console.log(`Cache: Miss for key: ${key}`);
    return null;
  }

  public setQuote(key: string, quote: Quote): void {
    console.log(`Cache: Setting entry for key: ${key}`);
    this.cache.set(key, {
      quote,
      timestamp: Date.now(),
    });
  }

  public generateKey(tokenIn: string, tokenOut: string, amount: string): string {
    return `${tokenIn}_${tokenOut}_${amount}`;
  }
}
