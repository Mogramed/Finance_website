export type MarketSource = 'BINANCE' | 'TWELVE_DATA' | 'TIINGO' | 'ALPHA_VANTAGE' | 'FRANKFURTER' | 'MOCK';
export type AssetType = 'CRYPTO' | 'FOREX' | 'STOCK';

export interface UniversalQuote {
  symbol: string;
  price: number;
  changePct: number;
  ts: number;
  source: MarketSource;
  type: AssetType;
}

export interface Candle {
  time: number;
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

export function getAssetType(symbol: string): AssetType {
  const s = symbol.toUpperCase();
  if (s.endsWith('USDT') || s.endsWith('BUSD') || ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'].includes(s)) {
    return 'CRYPTO';
  }
  // Forex : souvent 6 lettres (EURUSD) ou avec slash (EUR/USD)
  if (s.includes('/') || (s.length === 6 && !/\d/.test(s) && (s.startsWith('USD') || s.endsWith('USD') || s.startsWith('EUR') || s.startsWith('GBP')))) {
    return 'FOREX';
  }
  return 'STOCK';
}