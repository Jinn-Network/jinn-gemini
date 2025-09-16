# Demo Application

See also: [Technical Architecture - MVP](./mvp-spec.md).

## Objective

The primary goal is to demonstrate, learn from, and refine the Jinn network through a concrete, real-world application. This hands-on approach allows us to test and improve the core architecture in a practical setting.

## Chosen Platform: Zora Creator Economy

We have chosen the Zora content creation ecosystem as the focus for our demo application. Zora provides a compelling environment for several reasons:

- **Tokenomics:** It has a robust and active tokenomic model.
- **Community:** There is an engaged community of participants.
- **Liquidity:** The platform has established liquidity around creator coins (ERC-20s tied to media).
- **Innovation:** Zora is at the forefront of on-chain media financialization.

On-chain creator economies represent a sweet spot for agents where they require on-chain integration and have a high degree of potential autonomy, while avoiding the complex and expensive potential pitfalls of applications like finance or governance.

## High-Level Flow

The demo application will involve agents, run by operators, that participate in the Zora and Civitai ecosystems. The planned workflow is as follows:

1.  **Orchestration:** Operators will run Orchestrators that manage agents participating in the Zora content ecosystem.
2.  **Content Operations:** These agents will manage creator coins, which are ERC-20 tokens linked to image and video content.
3.  **Tooling:** Agents will leverage a suite of MCP tools for:
    - **Image Generation:** An image generation pipeline using Civitai.
    - **Human Feedback:** A human feedback pipeline, also via Civitai.
    - **Publishing:** Tools for publishing content on Zora.

## Current Status

The concrete details of the demo application are still being refined. The team's current priority is implementing the foundational MVP technical architecture that will support this application. This document will be updated as the underlying infrastructure matures.