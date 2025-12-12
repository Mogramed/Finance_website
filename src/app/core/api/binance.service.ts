import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, retry, catchError, shareReplay } from 'rxjs/operators';
import { webSocket } from 'rxjs/webSocket';
import { UniversalQuote, Candle } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class BinanceService {
  private http = inject(HttpClient);
  private readonly wsUrl = 'wss://stream.binance.com:9443/stream';
  private readonly apiUrl = 'https://api.binance.com/api/v3';

  // Cache pour la liste des symboles (évite de rappeler l'API lourde)
  private symbolsCache$: Observable<string[]> | null = null;

  // --- RECHERCHE ---
  search(query: string): Observable<{ symbol: string; description: string }[]> {
    if (!this.symbolsCache$) {
      // On charge la liste de TOUS les symboles Binance (c'est un gros JSON, on le cache)
      this.symbolsCache$ = this.http.get<any>(`${this.apiUrl}/exchangeInfo`).pipe(
        map(res => res.symbols.map((s: any) => s.symbol)),
        shareReplay(1)
      );
    }

    const q = query.toUpperCase();
    return this.symbolsCache$.pipe(
      map(symbols => {
        // On filtre localement
        return symbols
          .filter(s => s.includes(q))
          .slice(0, 10) // Top 10 résultats
          .map(s => ({ symbol: s, description: 'Crypto Asset' }));
      }),
      catchError(() => of([]))
    );
  }

  // ... (Garde le reste : connect, getKlines inchangé) ...
  connect(symbols: string[]): Observable<UniversalQuote> {
    if (!symbols.length) return of();
    const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
    const url = `${this.wsUrl}?streams=${streams}`;

    return webSocket<any>(url).pipe(
      map(msg => {
        const data = msg.data; 
        const current = parseFloat(data.c);
        const open = parseFloat(data.o);
        const changePct = open === 0 ? 0 : ((current - open) / open) * 100;
        return {
          symbol: data.s.toUpperCase(),
          price: current,
          changePct: changePct,
          ts: data.E,
          source: 'BINANCE',
          type: 'CRYPTO'
        } as UniversalQuote;
      }),
      retry({ delay: 3000 }),
      catchError(err => { console.error('Binance WS error', err); return of(); }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getKlines(symbol: string, interval: string = '1h', limit: number = 100): Observable<Candle[]> {
    return this.http.get<any[]>(`${this.apiUrl}/klines`, {
      params: { symbol: symbol.toUpperCase(), interval, limit }
    }).pipe(
      map(data => data.map(k => ({
        time: k[0] / 1000,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }))),
      catchError(() => of([]))
    );
  }
}