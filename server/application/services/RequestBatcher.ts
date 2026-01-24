import { TokenMetadata } from '../../../shared/tokens';

// A function type for the resolver of the promise
export type ResolveFunction = (value: any) => void;

// The structure of a request in our queue
export interface QuoteRequest {
  tokenIn: TokenMetadata;
  tokenOut: TokenMetadata;
  amount: string;
  resolve: ResolveFunction;
  id: string; // Unique ID for this request
}

// A placeholder for the controller service we will build next
interface Controller {
  getQuotes(requests: QuoteRequest[]): void;
}

export class RequestBatcher {
  private queue: QuoteRequest[] = [];
  private controller: Controller;

  constructor(controller: Controller) {
    this.controller = controller;
    setInterval(() => this.processQueue(), 100); // Process every 100ms
  }

  public addQuoteRequest(tokenIn: TokenMetadata, tokenOut: TokenMetadata, amount: string): Promise<any> {
    return new Promise((resolve) => {
      const id = `${tokenIn.address}_${tokenOut.address}_${amount}`;
      this.queue.push({ tokenIn, tokenOut, amount, resolve, id });
    });
  }

  private processQueue(): void {
    if (this.queue.length === 0) {
      return;
    }

    // Pass the whole queue to the controller
    const currentQueue = [...this.queue];
    this.queue = []; // Clear the queue for the next batch

    console.log(`RequestBatcher: Processing ${currentQueue.length} requests.`);

    this.controller.getQuotes(currentQueue);
  }
}
