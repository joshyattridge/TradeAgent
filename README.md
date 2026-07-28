# TradeAgent

Minimalist AI day-trading workspace: **Dashboard**, **Trading Logs**, **Strategy**, plus a floating chat that can log trades, update your plan, and generate charts on the fly.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## AI chat

Works out of the box with a local intent parser (no key needed).

For smarter chat, copy `.env.example` → `.env.local` and set:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

## Chat examples

- `show my equity curve`
- `R by symbol`
- `log trade EURUSD long 2R London CE fill`
- `update strategy: no trades during red folder news`

Data persists in the browser via localStorage. Seeded with your 1H FVG continuation playbook + sample trades.
