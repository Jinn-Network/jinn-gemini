# TypeScript MECH Client

A TypeScript client for interacting with Mechs on the blockchain.

## Installation

This project uses Yarn as the package manager:

```bash
yarn install
```

## Building

```bash
yarn build
```

## Usage

### Run commands directly with yarn:

```bash
# Send a request
yarn start interact --prompts "your prompt" --priority-mech <mech-address> --tools <tool-name> --chain-config base --post-only --key <private-key-file>

# Deliver a result
yarn start deliver --request-id <request-id> --result-file <result-file> --target-mech <mech-address> --multisig <safe-address> --key <private-key-file> --chain-config base
```

### Available Scripts

- `yarn build` - Compile TypeScript to JavaScript
- `yarn dev` - Run in development mode with ts-node
- `yarn start` - Run the compiled JavaScript
- `yarn test` - Run tests

## Configuration

The project is configured to use `node-modules` instead of Yarn's PnP mode for better TypeScript compatibility.
