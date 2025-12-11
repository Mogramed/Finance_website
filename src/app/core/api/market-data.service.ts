import { Injectable, inject } from '@angular/core';
import { Observable, merge, of, timer } from 'rxjs';
import { switchMap, scan, shareReplay } from 'rxjs/operators';
import { BinanceService } from './binance.service';
import { TwelveDataService } from './twelvedata.service';
import { UniversalQuote, getAssetType } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private binance = inject(BinanceService);
  private twelveData = inject(TwelveDataService);

  /**
   * Surveille une liste de symboles hétérogènes (Crypto + Stock + Forex)
   */
  watch(symbols: string[], refreshMs = 15000): Observable<UniversalQuote[]> {
    if (symbols.length === 0) return of([]);

    const crypto = symbols.filter(s => getAssetType(s) === 'CRYPTO');
    const others = symbols.filter(s => getAssetType(s) !== 'CRYPTO');

    const streams: Observable<UniversalQuote | UniversalQuote[]>[] = [];

    // 1. WebSocket Crypto (Temps réel - Push)
    if (crypto.length > 0) {
      streams.push(this.binance.connect(crypto));
    }

    // 2. HTTP Stock/Forex (Polling - Pull)
    // On met un refresh plus lent (15s) pour économiser ton quota Twelve Data (800 req/jour)
    if (others.length > 0) {
      const poller$ = timer(0, refreshMs).pipe(
        switchMap(() => this.twelveData.getQuotes(others))
      );
      streams.push(poller$);
    }

    // 3. Fusion des données
    return merge(...streams).pipe(
      scan((acc, val) => {
        const map = new Map(acc.map(q => [q.symbol, q]));
        
        if (Array.isArray(val)) {
          // Mise à jour de masse (Twelve Data)
          val.forEach(q => map.set(q.symbol, q));
        } else {
          // Mise à jour unitaire (Binance)
          map.set(val.symbol, val);
        }
        
        return Array.from(map.values());
      }, [] as UniversalQuote[]),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}