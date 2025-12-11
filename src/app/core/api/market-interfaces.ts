export type MarketSource = 'BINANCE' | 'TWELVE_DATA' | 'TIINGO' | 'MOCK';
export type AssetType = 'CRYPTO' | 'FOREX' | 'STOCK';

export interface UniversalQuote {
  symbol: string;
  price: number;
  changePct: number;
  ts: number;
  source: MarketSource;
  type: AssetType;
}

// NOUVEAU : Pour le graphique
export interface Candle {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CompanyProfile {
  name: string;
  description: string;
  exchange: string;
  sector: string;
  logo?: string;
}

// ... fonction getAssetType existante ...
export function getAssetType(symbol: string): AssetType {
  const s = symbol.toUpperCase();
  if (s.endsWith('USDT') || s.endsWith('BUSD') || ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'].includes(s)) {
    return 'CRYPTO';
  }
  if (s.includes('/') || (s.length === 6 && !/\d/.test(s) && (s.startsWith('USD') || s.endsWith('USD')))) {
    return 'FOREX';
  }
  return 'STOCK';
}