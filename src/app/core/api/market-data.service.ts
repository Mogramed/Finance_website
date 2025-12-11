import { Injectable, inject } from '@angular/core';
import { Observable, merge, of, timer } from 'rxjs';
import { switchMap, scan, shareReplay, catchError } from 'rxjs/operators';
import { BinanceService } from './binance.service';
import { TwelveDataService } from './twelvedata.service';
import { TiingoService } from './tiingo.service';
import { UniversalQuote, getAssetType } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private binance = inject(BinanceService);
  private twelveData = inject(TwelveDataService);
  private tiingo = inject(TiingoService);

  watch(symbols: string[], refreshMs = 30000): Observable<UniversalQuote[]> {
    if (symbols.length === 0) return of([]);

    const crypto = symbols.filter(s => getAssetType(s) === 'CRYPTO');
    const others = symbols.filter(s => getAssetType(s) !== 'CRYPTO');

    const streams: Observable<UniversalQuote | UniversalQuote[]>[] = [];

    // 1. WebSocket Crypto
    if (crypto.length > 0) {
      streams.push(this.binance.connect(crypto));
    }

    // 2. HTTP Stock/Forex
    // Refresh sécurisé (min 20s si beaucoup de symboles)
    const safeRefresh = Math.max(refreshMs, others.length > 2 ? 30000 : 15000);

    if (others.length > 0) {
      const poller$ = timer(0, safeRefresh).pipe(
        switchMap(() => this.twelveData.getQuotes(others).pipe(
          catchError(err => {
            console.warn('Erreur API Stocks:', err);
            return of([]); 
          })
        ))
      );
      streams.push(poller$);
    }

    return merge(...streams).pipe(
      // --- C'EST ICI QUE LA MAGIE OPÈRE ---
      scan((acc, val) => {
        // On crée une Map avec les anciennes valeurs
        const map = new Map(acc.map(q => [q.symbol, q]));
        
        // Fonction de mise à jour sécurisée
        const safeUpdate = (q: UniversalQuote) => {
          // ON NE MET À JOUR QUE SI LE PRIX EST VALIDE (> 0)
          // Si q.price est 0 ou null, on garde l'ancienne valeur dans la Map
          if (q && q.price > 0) {
            map.set(q.symbol, q);
          }
        };

        if (Array.isArray(val)) {
          val.forEach(safeUpdate);
        } else {
          safeUpdate(val);
        }
        
        return Array.from(map.values());
      }, [] as UniversalQuote[]),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}