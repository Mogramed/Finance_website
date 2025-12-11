import { Injectable, inject } from '@angular/core';
import { Observable, merge, of, timer } from 'rxjs';
import { switchMap, scan, shareReplay, catchError } from 'rxjs/operators';
import { BinanceService } from './binance.service';
import { TwelveDataService } from './twelvedata.service';
import { TiingoService } from './tiingo.service';
import { UniversalQuote, Candle, getAssetType, CompanyProfile } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private binance = inject(BinanceService);
  private twelveData = inject(TwelveDataService);
  private tiingo = inject(TiingoService);

  // ... méthode watch() existante inchangée ...
  watch(symbols: string[], refreshMs = 30000): Observable<UniversalQuote[]> {
    // (Garde ton code existant ici pour watch)
    if (symbols.length === 0) return of([]);
    const crypto = symbols.filter(s => getAssetType(s) === 'CRYPTO');
    const others = symbols.filter(s => getAssetType(s) !== 'CRYPTO');
    const streams: Observable<UniversalQuote | UniversalQuote[]>[] = [];

    if (crypto.length > 0) streams.push(this.binance.connect(crypto));
    
    const safeRefresh = Math.max(refreshMs, others.length > 2 ? 30000 : 15000);
    if (others.length > 0) {
      const poller$ = timer(0, safeRefresh).pipe(
        switchMap(() => this.twelveData.getQuotes(others).pipe(catchError(err => { console.warn('Erreur API Stocks:', err); return of([]); })))
      );
      streams.push(poller$);
    }

    return merge(...streams).pipe(
      scan((acc, val) => {
        const map = new Map(acc.map(q => [q.symbol, q]));
        const safeUpdate = (q: UniversalQuote) => { if (q && q.price > 0) map.set(q.symbol, q); };
        if (Array.isArray(val)) val.forEach(safeUpdate); else safeUpdate(val);
        return Array.from(map.values());
      }, [] as UniversalQuote[]),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /** NOUVEAU : Récupère l'historique (Bougies) */
  getHistory(symbol: string): Observable<Candle[]> {
    const type = getAssetType(symbol);
    if (type === 'CRYPTO') {
      return this.binance.getKlines(symbol);
    } else {
      // Stock/Forex -> Twelve Data
      return this.twelveData.getTimeSeries(symbol);
    }
  }

  /** NOUVEAU : Récupère les infos fondamentales */
  getCompanyProfile(symbol: string): Observable<CompanyProfile | null> {
    return this.tiingo.getMeta(symbol);
  }

  /** NOUVEAU : Récupère les news */
  getNews(symbol: string): Observable<any[]> {
    return this.tiingo.getNews(symbol);
  }
}