#!/usr/bin/env bash

cat <<EOF > .env
# RPC / Provider keys
INFURA_API_KEY= $INFURA_API_KEY
ALCHEMY_API_KEY= $ALCHEMY_API_KEY=

# Block explorer keys
ETHERSCAN_API_KEY= $ETHERSCAN_API_KEY
POLYGONSCAN_API_KEY= $POLYGONSCAN_API_KEY

# Optional polygon-specific fallback RPC (if you don't want a provider)
POLYGON_RPC_URL=https://polygon-rpc.com

# Legacy/alternative key name (kept for compatibility)
POLYGON_API_KEY=https://polygon-rpc.com

# App config
PORT=3002

EOF