/**
 * ContractAddressConfig
 * 
 * Centralized configuration for protocol and infrastructure contract addresses.
 * Organized by network and purpose.
 */

interface ContractAddresses {
  multicall: string;
  uniswapV3Factory: string;
}

const CONTRACT_ADDRESSES: {
  ethereum: ContractAddresses;
  polygon: ContractAddresses;
  [key: string]: ContractAddresses;
} = {
  ethereum: {
    // Multicall3: Universal multicall contract across all networks
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
    
    // Uniswap V3 Factory: Used for discovering pools
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  },
  
  polygon: {
    // Multicall3: Same address on Polygon
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
    
    // Uniswap V3 Factory: Same address on Polygon
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  },
};

/**
 * Get contract address for a specific network
 * @param chainId - Network chain ID (1 = Ethereum, 137 = Polygon)
 * @param contract - Contract name (multicall, uniswapV3Factory)
 * @returns Contract address
 */
export function getContractAddress(
  chainId: number | string,
  contract: keyof ContractAddresses
): string {
  const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
  
  let networkKey: string;
  if (id === 1 || id === 5 || id === 11155111) {
    // Ethereum mainnet, Goerli, Sepolia
    networkKey = 'ethereum';
  } else if (id === 137 || id === 80001) {
    // Polygon mainnet, Mumbai testnet
    networkKey = 'polygon';
  } else {
    // Default to Ethereum for unknown chains
    networkKey = 'ethereum';
  }
  
  const address = CONTRACT_ADDRESSES[networkKey][contract];
  if (!address) {
    throw new Error(`Contract '${contract}' not configured for chainId ${chainId}`);
  }
  
  return address;
}

export const ContractAddressConfig = CONTRACT_ADDRESSES;
