import { useState, useEffect } from 'react';
import { Search, Plus, TrendingUp, Loader } from 'lucide-react';
import { useMarketOverview } from '@/hooks/useMarketOverview';
import { useDebounce } from '@/hooks/useDebounce';
import { marketViewerClient } from '@/lib/api/MarketViewerClient';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card } from './ui/card';
import type { TokenMarketData, TokenSearchResult } from '@shared/schema';

interface TokenMarketViewProps {
  chainId: number;
  onAddToken?: (address: string) => void;
  isAddingToken?: boolean;
}

export function TokenMarketView({ chainId, onAddToken, isAddingToken }: TokenMarketViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddToken, setShowAddToken] = useState(false);
  const [newTokenAddress, setNewTokenAddress] = useState('');
  
  // Debounce search input (300ms delay)
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  
  // Search results state
  const [searchResults, setSearchResults] = useState<TokenSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Fetch market overview
  const { data: overview, isLoading, error } = useMarketOverview(chainId);

  // When search term changes (after debounce), call server search
  useEffect(() => {
    if (debouncedSearchTerm.trim().length === 0) {
      // No search term - clear results
      setSearchResults([]);
      return;
    }

    // Call server search API
    const performSearch = async () => {
      setIsSearching(true);
      try {
        const results = await marketViewerClient.searchTokens(debouncedSearchTerm, chainId);
        setSearchResults(results || []);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    performSearch();
  }, [debouncedSearchTerm, chainId]);

  const tokens = overview?.tokens || [];

  // If user has entered search term, show search results; otherwise show full token list with client-side filter
  const displayTokens = debouncedSearchTerm.trim().length > 0 
    ? searchResults.map(result => ({
        address: result.address,
        symbol: result.symbol,
        name: result.name,
        decimals: result.decimals,
        chainId: result.chainId,
        price: 0,
        priceChange24h: 0,
        liquidity: 0,
        volume24h: 0,
        holders: 0,
        dataSource: 'cached' as const,
        timestamp: Date.now(),
        cachedUntil: Date.now(),
      }) as TokenMarketData)
    : tokens;

  const handleAddToken = () => {
    if (newTokenAddress.trim() && onAddToken) {
      onAddToken(newTokenAddress.trim());
      setNewTokenAddress('');
      setShowAddToken(false);
    }
  };

  return (
    <div className="mt-8">
      <h2 className="text-xl font-bold mb-4">Market Overview</h2>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader className="w-5 h-5 animate-spin mr-2" />
          Loading market data...
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4">
          Error loading market data. Please try again.
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              type="text"
              placeholder="Search tokens by symbol, name or address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            {isSearching && debouncedSearchTerm && (
              <Loader className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
            )}
            {onAddToken && (
              <Button
                onClick={() => setShowAddToken(!showAddToken)}
                variant="outline"
                size="sm"
                className="absolute right-10 top-1/2 transform -translate-y-1/2"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            )}
          </div>

          {showAddToken && (
            <Card className="p-4 mb-4 bg-blue-50">
              <div className="space-y-2">
                <label className="block text-sm font-medium">Token Contract Address</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="0x..."
                    value={newTokenAddress}
                    onChange={(e) => setNewTokenAddress(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleAddToken}
                    disabled={isAddingToken || !newTokenAddress.trim()}
                  >
                    {isAddingToken ? 'Adding...' : 'Add'}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayTokens.length === 0 ? (
              <div className="col-span-full text-center py-8 text-gray-500">
                {debouncedSearchTerm && isSearching ? 'Searching...' : debouncedSearchTerm ? 'No tokens found' : 'No tokens available'}
              </div>
            ) : (
              displayTokens.map((token) => (
                <Card key={token.address} className="p-4 hover:shadow-lg transition">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-bold text-lg">{token.symbol}</p>
                      <p className="text-sm text-gray-600">{token.name}</p>
                    </div>
                    {token.priceChange24h !== undefined && (
                      <div className={`text-sm font-semibold ${(token.priceChange24h || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        <div className="flex items-center gap-1">
                          <TrendingUp className="w-4 h-4" />
                          {(token.priceChange24h || 0) >= 0 ? '+' : ''}{(token.priceChange24h || 0).toFixed(2)}%
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Price:</span>
                      <span className="font-semibold">${token.price.toFixed(2)}</span>
                    </div>
                    {token.marketCap && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Market Cap:</span>
                        <span className="font-semibold">${(token.marketCap / 1e9).toFixed(2)}B</span>
                      </div>
                    )}
                    {token.liquidity && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Liquidity:</span>
                        <span className="font-semibold">${(token.liquidity / 1e6).toFixed(2)}M</span>
                      </div>
                    )}
                    {token.volume24h && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">24h Volume:</span>
                        <span className="font-semibold">${(token.volume24h / 1e6).toFixed(2)}M</span>
                      </div>
                    )}
                    {token.dataSource && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Source:</span>
                        <span className="text-xs font-semibold text-blue-600">{token.dataSource}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-gray-500 truncate">{token.address}</p>
                  </div>
                </Card>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
