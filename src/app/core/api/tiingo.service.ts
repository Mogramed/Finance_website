import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { UniversalQuote } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class TiingoService {
  private http = inject(HttpClient);
  // Ta clé API Tiingo
  private readonly apiKey = '1a237f4a00b4a7b6a855b22c071f90797b2cd545';
  private readonly baseUrl = 'https://api.tiingo.com';

  /**
   * Tiingo gère différemment les Stocks (IEX) et le Forex.
   * Cette méthode unifiée décide quelle endpoint appeler.
   */
  getQuote(symbol: string): Observable<UniversalQuote | null> {
    // Si c'est une paire Forex (ex: eurusd ou eur/usd)
    if (symbol.includes('/') || (symbol.length === 6 && !/\d/.test(symbol))) {
      const ticker = symbol.replace('/', '').toLowerCase(); // Tiingo format: eurusd
      return this.http.get<any[]>(`${this.baseUrl}/tiingo/fx/top?tickers=${ticker}&token=${this.apiKey}`).pipe(
        map(res => {
          if (!res || res.length === 0) return null;
          const data = res[0]; // { ticker: 'eurusd', midPrice: 1.05, ... }
          return {
            symbol: symbol.toUpperCase(),
            price: data.midPrice,
            changePct: 0, // Tiingo FX Top ne donne pas toujours le change % 24h direct ici
            ts: new Date(data.quoteTimestamp).getTime(),
            source: 'TIINGO',
            type: 'FOREX'
          } as UniversalQuote;
        }),
        catchError(() => of(null))
      );
    } 
    
    // Sinon c'est un Stock (IEX)
    return this.http.get<any[]>(`${this.baseUrl}/iex/?tickers=${symbol}&token=${this.apiKey}`).pipe(
      map(res => {
        if (!res || res.length === 0) return null;
        const data = res[0]; // { tsov: '2023...', last: 150.2, ... }
        return {
          symbol: data.ticker.toUpperCase(),
          price: data.last,
          changePct: 0, // L'endpoint IEX simple est très temps réel mais minimaliste sur la variation
          ts: new Date(data.timestamp).getTime(),
          source: 'TIINGO',
          type: 'STOCK'
        } as UniversalQuote;
      }),
      catchError(() => of(null))
    );
  }

  // Tiingo est excellent pour les News, on prépare la méthode pour la suite
  getNews(symbol: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/tiingo/news`, {
      params: { tickers: symbol, token: this.apiKey }
    }).pipe(catchError(() => of([])));
  }
}