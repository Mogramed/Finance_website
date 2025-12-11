import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, retry, catchError, shareReplay } from 'rxjs/operators';
import { webSocket } from 'rxjs/webSocket';
import { UniversalQuote } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class BinanceService {
  private readonly baseUrl = 'wss://stream.binance.com:9443/stream';

  connect(symbols: string[]): Observable<UniversalQuote> {
    if (!symbols.length) return of();

    // Binance demande les symboles en minuscule (ex: btcusdt@miniTicker)
    const streams = symbols
      .map(s => `${s.toLowerCase()}@miniTicker`)
      .join('/');

    const url = `${this.baseUrl}?streams=${streams}`;

    return webSocket<any>(url).pipe(
      map(msg => {
        const data = msg.data; 
        // Payload Binance miniTicker : { c: close, o: open, s: symbol, ... }
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
      retry({ delay: 3000 }), // Reconnexion auto
      catchError(err => {
        console.error('Binance WS error', err);
        return of(); 
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}