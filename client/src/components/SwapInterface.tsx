import { useState } from 'react';
import { TokenMetadata } from '../../../shared/tokens';
import { TokenSelector } from './TokenSelector';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../shared/routes';

interface SwapInterfaceProps {
  tokens: TokenMetadata[];
}

export function SwapInterface({ tokens }: SwapInterfaceProps) {
  const [amount, setAmount] = useState('');
  const [tokenIn, setTokenIn] = useState<TokenMetadata | null>(null);
  const [tokenOut, setTokenOut] = useState<TokenMetadata | null>(null);

  const { data: quote, isLoading, error } = useQuery({
    queryKey: ['quote', tokenIn?.address, tokenOut?.address, amount],
    queryFn: async () => {
      if (!tokenIn || !tokenOut || !amount) {
        return null;
      }
      const res = await fetch(api.quote.get.path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tokenIn, tokenOut, amount }),
      });
      return res.json();
    },
    enabled: !!tokenIn && !!tokenOut && !!amount,
  });

  return (
    <div>
      <div>
        <label>From:</label>
        <TokenSelector tokens={tokens} selectedToken={tokenIn} onSelectToken={setTokenIn} />
        <input 
          type="number" 
          value={amount} 
          onChange={(e) => setAmount(e.target.value)} 
          placeholder="Amount"
        />
      </div>
      <div>
        <label>To:</label>
        <TokenSelector tokens={tokens} selectedToken={tokenOut} onSelectToken={setTokenOut} />
      </div>
      {isLoading && <p>Loading...</p>}
      {error && <p>Error: {error.message}</p>}
      {quote && (
        <div>
          <p>Price: {quote.price}</p>
          <p>Pool: {quote.poolAddress}</p>
        </div>
      )}
    </div>
  );
}
