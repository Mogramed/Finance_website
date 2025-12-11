import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { UniversalQuote, Candle } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class TwelveDataService {
  private http = inject(HttpClient);
  private readonly apiKey = '9b8c75d1856e45ecbf6b574f6e0bd9c0';
  private readonly baseUrl = 'https://api.twelvedata.com';

  // ... getQuotes et search existants ...
  getQuotes(symbols: string[]): Observable<UniversalQuote[]> {
    if (!symbols.length) return of([]);
    const symString = symbols.join(',');
    return this.http.get<any>(`${this.baseUrl}/quote`, {
      params: { symbol: symString, apikey: this.apiKey }
    }).pipe(
      map(res => {
        let rawItems: any[] = [];
        if (res.symbol) rawItems = [res];
        else if (typeof res === 'object') rawItems = Object.values(res).filter((x: any) => x.symbol);
        return rawItems.map(item => ({
          symbol: item.symbol,
          price: parseFloat(item.close),
          changePct: parseFloat(item.percent_change),
          ts: Date.now(), 
          source: 'TWELVE_DATA',
          type: item.symbol.includes('/') ? 'FOREX' : 'STOCK'
        } as UniversalQuote)).filter(q => q.price > 0 && !isNaN(q.price));
      }),
      catchError(err => { console.warn('TwelveData Error:', err); return of([]); })
    );
  }

  search(query: string): Observable<{ symbol: string; description: string }[]> {
    if (!query || query.length < 2) return of([]);
    return this.http.get<any>(`${this.baseUrl}/symbol_search`, {
      params: { symbol: query, outputsize: '10' }
    }).pipe(
      map(res => !res.data ? [] : res.data.map((item: any) => ({ symbol: item.symbol, description: item.instrument_name }))),
      catchError(() => of([]))
    );
  }

  // NOUVEAU : Historique pour le graphique
  getTimeSeries(symbol: string, interval: string = '1h', outputsize: string = '50'): Observable<Candle[]> {
    return this.http.get<any>(`${this.baseUrl}/time_series`, {
      params: { symbol, interval, outputsize, apikey: this.apiKey }
    }).pipe(
      map(res => {
        if (!res.values || !Array.isArray(res.values)) return [];
        // TwelveData renvoie du plus récent au plus vieux, on inverse pour le chart
        return res.values.reverse().map((k: any) => ({
          time: new Date(k.datetime).getTime() / 1000,
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
        }));
      }),
      catchError(() => of([]))
    );
  }
}