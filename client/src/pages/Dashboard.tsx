import { useQuery } from '@tanstack/react-query';
import { api } from '../../../shared/routes';
import { SwapInterface } from '../components/SwapInterface';
import { TokenMetadata } from '../../../shared/tokens';

export default function Dashboard() {
  const { data: tokens, isLoading, error } = useQuery<{
    tokens: TokenMetadata[];
  }>({
    queryKey: ['tokens'],
    queryFn: async () => {
      const res = await fetch(api.tokens.getAll.path);
      return res.json();
    },
  });

  if (isLoading) {
    return <div>Loading tokens...</div>;
  }

  if (error || !tokens) {
    return <div>Error loading tokens.</div>;
  }

  return (
    <div>
      <h1>Swap</h1>
      <SwapInterface tokens={tokens.tokens} />
    </div>
  );
}
