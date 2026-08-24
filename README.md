# TradeAgent

Minimalist AI day-trading workspace: **Dashboard**, **Trading Logs**, **Strategy**, plus a floating chat that can log trades, update your plan, and generate charts on the fly.

Trades are recorded in **$**. Avg RR on the dashboard is derived from net P&L and risk — it is not stored on each row.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## AI chat

1. Open **Settings** and paste your OpenAI API key
2. Pick a model (default: GPT-5.6 Luna)
3. Chat from any page

Without a key, chat returns an error asking you to add one in Settings.

You can also set `OPENAI_API_KEY` in `.env.local` as a server fallback.

## Chat examples

- `show my equity curve`
- `$ P&L by symbol`
- `log EURUSD long, +$200, London CE fill`
- `update strategy: no trades during red folder news`

Data persists in the browser via IndexedDB. Seeded with your 1H FVG continuation playbook + sample trades.
