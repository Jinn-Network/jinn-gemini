# Distribution-First Strategy for Agentic Ventures

## Memo for Ritsu

**From:** Oak  
**Date:** November 2025  
**Re:** Shifting from engineering mode to distribution mode

---

## Context: Where This Conversation Started

We've been deep in engineering mode. Building the coordination layer, the OLAS integration, the agent execution infrastructure. The product is genuinely interesting from a technical standpoint—autonomous ventures that can break down work, execute via marketplace nodes, push code, review it, iterate.

But we've been neglecting distribution. And the evidence from successful founders is unambiguous on this point.

### What the best founders say about distribution

Peter Thiel's formulation in *Zero to One* is blunt: "Superior sales and distribution by itself can create a monopoly, even with no product differentiation. The converse is not true." And more critically: "Most businesses get zero distribution channels to work: poor sales rather than bad product is the most common cause of failure."

Reid Hoffman devoted roughly 80% of LinkedIn's early resources to viral growth. Not product. Distribution.

The PayPal team understood from day one that product distribution had to be integral to the strategy—not something figured out later. They built the viral loop into the product itself: sending money forced recipients to sign up. They stacked mechanisms: inherent virality from the payment action, referral bonuses, and embeddable "Pay with PayPal" buttons that let eBay sellers spread the product for them.

Marc Andreessen observes that "many entrepreneurs who build great products simply don't have a good distribution strategy. Even worse is when they insist that they don't need one, or call no distribution strategy a 'viral marketing strategy.'"

The question we need to answer: **What is our eBay?** What existing network or behaviour can our agents piggyback on, where the integration itself creates the viral loop?

---

## The Insight: Distribution as Capture of Existing Behaviour

The key realisation from this conversation: we shouldn't ask people to change what they're doing. We should capture value from what they already do, and retroactively give them ownership in the venture that monetised their contribution.

This inverts the typical model. Instead of "opt in, then contribute, then receive tokens," it becomes "you already contributed publicly, we extracted value, here are your tokens."

The psychological trigger is discovery of latent value, not effort to create new value.

---

## The Failed Version: Pure Open Source Recognition

The first iteration we explored was tokenising contributions to open source repos—scanning commit graphs, allocating tokens based on contribution weight, airdropping to developers.

This doesn't work because **open source has no revenue**. The token either becomes purely speculative (crypto nonsense) or we're subsidising distribution from our own pocket with no path to sustainability.

---

## The Working Version: x402-Wrapped Open Source as Autonomous API Businesses

### The Model

1. **Preselect open source repos** with potential for API-as-a-service monetisation
2. **Agentic venture forks/wraps the repo**, makes it x402-ready (payment-gated API access via Coinbase's protocol)
3. **Historical contributors get airdropped tokens** based on the commit graph
4. **Agents deploy and maintain the service** (human-assisted initially, fully autonomous as we mature)
5. **x402 payments flow directly to the venture's treasury**
6. **Treasury does buybacks** rather than distributions, avoiding taxable events for token holders
7. **Our own agent network becomes a customer** of these services, creating a flywheel

### Why This Closes the Loop

- There's actual revenue (x402 API payments)
- The token represents a claim on real cash flows, not speculation
- Contributors are rewarded for work they already did, for free, with no expectation of payment
- The buyback mechanism lets people realise value on their own timeline
- We dogfood the services ourselves, which validates quality and creates demand

---

## Selection Criteria for Repos

The selection heuristic is self-reinforcing:

1. **Utility to our own agents**: We only support repos whose APIs would be valuable enough that our agents would actually pay for the service. This creates a tight feedback loop—if an API isn't being used, we deprecate support quickly.

2. **Technical criteria**: Favour specific technologies (e.g., Docker, TypeScript) to make the x402 upgrade path predictable and automatable.

3. **Endpoint-oriented architecture**: The repo's core output should be something that naturally expresses as an API endpoint. This is the constraint that makes the x402 wrapping trivial.

4. **Licence check**: Verify the open source licence permits commercial wrapping. This is a simple filter.

The agents can learn this heuristic over time, but initially it's a curated funnel with human judgment.

---

## The Distribution Mechanic

### The User Experience

An open source contributor receives an email (or on-chain notification):

> "Your commits to [repo] have been tokenised. An autonomous venture is now selling API access to this project via x402. You have [n] tokens claimable at [deterministic address]. The treasury is doing buybacks from revenue. Here's the dashboard."

They didn't ask for this. They don't have to do anything. But if they're curious, they look. If they look, they understand. If they understand, they might tell other contributors.

### Why This Is a Viral Loop

- The initial airdrop is a forcing function for attention—people look at things that claim to have already given them money
- The ongoing buybacks create passive value accrual—even if you do nothing, your tokens may appreciate
- Contributors who keep contributing to the wrapped repo continue earning tokens
- Each new repo wrapped is a new distribution event to a new set of developers
- Developers are the right beachhead market: they understand tokens, they're less likely to dismiss crypto-adjacent outreach as spam, and they have networks

---

## Implications for Product Design

### What This Means for Our Current Build

We've built the coordination and execution layer. The distribution strategy now tells us what to prioritise:

1. **x402 integration**: Agents need to be able to wrap repos with x402 payment gating. This should be a core capability, not a nice-to-have.

2. **Commit graph parsing**: We need to be able to deterministically allocate tokens based on contribution history. This is probably straightforward.

3. **Deterministic address creation**: Using CREATE2 or similar, we need to be able to generate claimable addresses from email addresses or GitHub identities before the user has ever interacted with us.

4. **Treasury and buyback logic**: The on-chain component that receives x402 revenue and executes buybacks needs to be robust and transparent.

5. **Server deployment**: Initially human-assisted, but the agents should be generating deployment instructions that we execute. Over time, this becomes autonomous via crypto-native compute platforms or direct server provisioning.

### What We Can Defer

- Perfect code quality from the agents (legibility of the value proposition matters more)
- Fully autonomous deployment (we can be in the loop initially)
- Sophisticated contribution weighting (simple commit counts are fine for MVP)
- Broad repo coverage (start with a handful that we'd actually use)

---

## Dogfooding: Our Own Codebase

This model solves our founder compensation question. We can:

1. Wrap our own protocol as the first x402-enabled service
2. Allocate tokens to ourselves based on our contribution history
3. Use this as the live example we point at when explaining the system to others

"Here's what we did with our own repo" is a much stronger pitch than "here's what we could do with yours."

---

## Next Steps

1. **Identify 3-5 repos** (including our own) that fit the selection criteria and that our agents would actually consume
2. **Build the x402 wrapping flow** as a first-class agent capability
3. **Implement commit graph → token allocation** logic
4. **Set up the treasury and buyback contracts**
5. **Draft the notification/claim flow** for contributors
6. **Deploy the first wrapped service** and start generating revenue

The emphasis should be on getting one complete loop working end-to-end, not on breadth or perfection. We can iterate once we have live revenue and real contributors discovering their tokens.

---

## Summary

We started this conversation asking "what have successful founders said about distribution?" The answer was consistent: distribution is as important as product, and the best companies build distribution into the product itself rather than bolting it on later.

For us, the distribution strategy is: **wrap open source repos in x402 payment gating, retroactively tokenise contributor graphs, share revenue via buybacks, and dogfood the services ourselves to create demand.**

This gives us:
- A clear viral loop (contributors discover latent value)
- Real revenue (x402 payments)
- A sustainable token model (buybacks from actual cash flows)
- A tight feedback loop (we only support what our agents actually use)
- A way to compensate ourselves for work already done

The product question becomes: what's the minimum viable flow for an agent to take an open source repo and make it a revenue-generating x402 API service?

Let's build that.
