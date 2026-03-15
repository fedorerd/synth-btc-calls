const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

interface OrderbookLevel {
  price: string;
  size: string;
}

interface OrderBookSummary {
  market: string;
  asset_id: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  last_trade_price: string;
}

export interface LiveOrderbook {
  bestBid: number;
  bestAsk: number;
  spread: number;
  bidDepth: number;
  askDepth: number;
  lastTradePrice: number;
}

function parseBook(book: OrderBookSummary): LiveOrderbook {
  const bids = book.bids.filter(b => parseFloat(b.size) > 0);
  const asks = book.asks.filter(a => parseFloat(a.size) > 0);

  const bestBid = bids.length > 0 ? Math.max(...bids.map(b => parseFloat(b.price))) : 0;
  const bestAsk = asks.length > 0 ? Math.min(...asks.map(a => parseFloat(a.price))) : 1;
  const bidDepth = bids.reduce((s, b) => s + parseFloat(b.size), 0);
  const askDepth = asks.reduce((s, a) => s + parseFloat(a.size), 0);

  return {
    bestBid,
    bestAsk,
    spread: +(bestAsk - bestBid).toFixed(4),
    bidDepth: +bidDepth.toFixed(2),
    askDepth: +askDepth.toFixed(2),
    lastTradePrice: parseFloat(book.last_trade_price) || 0,
  };
}

async function fetchBook(tokenId: string): Promise<LiveOrderbook | null> {
  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${tokenId}`, {
      next: { revalidate: 5 },
    });
    if (!res.ok) return null;
    const book: OrderBookSummary = await res.json();
    return parseBook(book);
  } catch {
    return null;
  }
}

export async function fetchLiveOrderbook(
  slug: string,
): Promise<{ up: LiveOrderbook | null; down: LiveOrderbook | null }> {
  try {
    const marketRes = await fetch(`${GAMMA_BASE}/markets/slug/${slug}`, {
      next: { revalidate: 10 },
    });
    if (!marketRes.ok) return { up: null, down: null };

    const market = await marketRes.json();
    if (!market.clobTokenIds) return { up: null, down: null };

    const tokenIds: string[] = JSON.parse(market.clobTokenIds);
    if (tokenIds.length < 2) return { up: null, down: null };

    const [up, down] = await Promise.all([
      fetchBook(tokenIds[0]),
      fetchBook(tokenIds[1]),
    ]);

    return { up, down };
  } catch {
    return { up: null, down: null };
  }
}
