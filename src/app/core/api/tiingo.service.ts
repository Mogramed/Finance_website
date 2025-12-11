import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { UniversalQuote, CompanyProfile } from './market-interfaces';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TiingoService {
  private http = inject(HttpClient);
  private readonly apiKey = environment.apiKeys.tiingo;;
  private readonly baseUrl = 'https://api.tiingo.com';

  // ... getQuote existant ...
  getQuote(symbol: string): Observable<UniversalQuote | null> {
    if (symbol.includes('/') || (symbol.length === 6 && !/\d/.test(symbol))) {
      const ticker = symbol.replace('/', '').toLowerCase();
      return this.http.get<any[]>(`${this.baseUrl}/tiingo/fx/top?tickers=${ticker}&token=${this.apiKey}`).pipe(
        map(res => (!res || res.length === 0) ? null : {
            symbol: symbol.toUpperCase(),
            price: res[0].midPrice,
            changePct: 0,
            ts: new Date(res[0].quoteTimestamp).getTime(),
            source: 'TIINGO',
            type: 'FOREX'
          } as UniversalQuote),
        catchError(() => of(null))
      );
    } 
    return this.http.get<any[]>(`${this.baseUrl}/iex/?tickers=${symbol}&token=${this.apiKey}`).pipe(
      map(res => (!res || res.length === 0) ? null : {
          symbol: res[0].ticker.toUpperCase(),
          price: res[0].last,
          changePct: 0,
          ts: new Date(res[0].timestamp).getTime(),
          source: 'TIINGO',
          type: 'STOCK'
        } as UniversalQuote),
      catchError(() => of(null))
    );
  }

  // ... getNews existant ...
  getNews(symbol: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/tiingo/news`, {
      params: { tickers: symbol, token: this.apiKey }
    }).pipe(catchError(() => of([])));
  }

  // NOUVEAU : Description de l'entreprise
  getMeta(symbol: string): Observable<CompanyProfile | null> {
    // Tiingo Meta ne marche bien que pour les Stocks US
    return this.http.get<any>(`${this.baseUrl}/tiingo/daily/${symbol}`, {
      params: { token: this.apiKey }
    }).pipe(
      map(res => ({
        name: res.name,
        description: res.description,
        exchange: res.exchangeCode,
        sector: res.sector || 'Unknown'
      })),
      catchError(() => of(null))
    );
  }
}