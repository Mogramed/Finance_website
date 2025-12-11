export type MarketSource = 'BINANCE' | 'TWELVE_DATA' | 'TIINGO' | 'MOCK';
export type AssetType = 'CRYPTO' | 'FOREX' | 'STOCK';

// Le format standard unique pour tout le site
export interface UniversalQuote {
  symbol: string;
  price: number;
  changePct: number;
  ts: number;          // Timestamp en ms
  source: MarketSource;
  type: AssetType;
}

// Petite fonction utilitaire pour deviner le type d'actif
export function getAssetType(symbol: string): AssetType {
  const s = symbol.toUpperCase();
  // Crypto : finit souvent par USDT, BUSD ou est un coin majeur
  if (s.endsWith('USDT') || s.endsWith('BUSD') || ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'].includes(s)) {
    return 'CRYPTO';
  }
  // Forex : contient / ou est une paire de devises connue (ex: EURUSD)
  if (s.includes('/') || (s.length === 6 && !/\d/.test(s) && (s.startsWith('USD') || s.endsWith('USD')))) {
    return 'FOREX';
  }
  return 'STOCK';
}