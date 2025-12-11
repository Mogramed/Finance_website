import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http'; // <-- Import HttpClient
import { Observable, of } from 'rxjs';
import { map, retry, catchError, shareReplay } from 'rxjs/operators';
import { webSocket } from 'rxjs/webSocket';
import { UniversalQuote, Candle } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class BinanceService {
  private http = inject(HttpClient); // <-- Injecter HttpClient
  private readonly wsUrl = 'wss://stream.binance.com:9443/stream';
  private readonly apiUrl = 'https://api.binance.com/api/v3';

  // ... méthode connect() existante inchangée ...
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

  // NOUVEAU : Historique pour le graphique
  getKlines(symbol: string, interval: string = '1h', limit: number = 100): Observable<Candle[]> {
    return this.http.get<any[]>(`${this.apiUrl}/klines`, {
      params: { symbol: symbol.toUpperCase(), interval, limit }
    }).pipe(
      map(data => data.map(k => ({
        time: k[0] / 1000, // Binance envoie ms, le chart veut secondes
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }))),
      catchError(() => of([]))
    );
  }
}