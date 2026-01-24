import { Quote } from '../../domain/pricing';
import { ResolveFunction } from './RequestBatcher';

export class DispatcherService {
  private pendingRequests: Map<string, ResolveFunction[]> = new Map();

  public register(requestId: string, resolve: ResolveFunction): void {
    if (!this.pendingRequests.has(requestId)) {
      this.pendingRequests.set(requestId, []);
    }
    this.pendingRequests.get(requestId)!.push(resolve);
  }

  public dispatch(requestId: string, quote: Quote): void {
    const resolvers = this.pendingRequests.get(requestId);
    if (resolvers) {
      console.log(`Dispatcher: Resolving ${resolvers.length} promises for request ID ${requestId}`);
      resolvers.forEach(resolve => resolve(quote));
      this.pendingRequests.delete(requestId);
    }
  }
}
