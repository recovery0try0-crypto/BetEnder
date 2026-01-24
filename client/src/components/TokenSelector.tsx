import { TokenMetadata } from "../../../shared/tokens";

interface TokenSelectorProps {
  tokens: TokenMetadata[];
  selectedToken: TokenMetadata | null;
  onSelectToken: (token: TokenMetadata) => void;
}

export function TokenSelector({ tokens, selectedToken, onSelectToken }: TokenSelectorProps) {
  return (
    <select 
      onChange={(e) => {
        const token = tokens.find(t => t.address === e.target.value);
        if (token) {
          onSelectToken(token);
        }
      }}
      value={selectedToken?.address || ''}
    >
      <option value="" disabled>Select a token</option>
      {tokens.map(token => (
        <option key={token.address} value={token.address}>
          {token.symbol}
        </option>
      ))}
    </select>
  );
}
