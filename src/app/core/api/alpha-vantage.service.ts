import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { UniversalQuote, Candle } from './market-interfaces';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AlphaVantageService {
  private http = inject(HttpClient);
  // Ta clé Alpha Vantage
  private readonly apiKey = environment.apiKeys.alphaVantage; 
  private readonly baseUrl = 'https://www.alphavantage.co/query';

  /** Recherche de symboles (Actions, ETF...) */
  search(query: string): Observable<{ symbol: string; description: string }[]> {
    return this.http.get<any>(this.baseUrl, {
      params: { function: 'SYMBOL_SEARCH', keywords: query, apikey: this.apiKey }
    }).pipe(
      map(res => {
        const matches = res['bestMatches'];
        if (!matches) return [];
        return matches.map((m: any) => ({
          symbol: m['1. symbol'],
          description: `${m['2. name']} (${m['4. region']})`
        }));
      }),
      catchError(() => of([]))
    );
  }

  /** Prix en temps réel (Global Quote) */
  getQuote(symbol: string): Observable<UniversalQuote | null> {
    return this.http.get<any>(this.baseUrl, {
      params: { function: 'GLOBAL_QUOTE', symbol: symbol, apikey: this.apiKey }
    }).pipe(
      map(res => {
        const data = res['Global Quote'];
        if (!data || !data['05. price']) return null;
        return {
          symbol: data['01. symbol'],
          price: parseFloat(data['05. price']),
          changePct: parseFloat(data['10. change percent'].replace('%', '')),
          ts: Date.now(), // Alpha Vantage ne donne pas le timestamp exact en millisecondes
          source: 'ALPHA_VANTAGE',
          type: 'STOCK'
        } as UniversalQuote;
      }),
      catchError(err => {
        console.warn('AlphaVantage Quote Error:', err);
        return of(null);
      })
    );
  }

  /** Historique journalier pour le graphique */
  getHistory(symbol: string): Observable<Candle[]> {
    return this.http.get<any>(this.baseUrl, {
      params: { function: 'TIME_SERIES_DAILY', symbol: symbol, apikey: this.apiKey }
    }).pipe(
      map(res => {
        const series = res['Time Series (Daily)'];
        if (!series) return [];
        // On transforme l'objet en tableau et on le trie chronologiquement
        return Object.keys(series).slice(0, 100).map(date => ({
          time: new Date(date).getTime() / 1000,
          open: parseFloat(series[date]['1. open']),
          high: parseFloat(series[date]['2. high']),
          low: parseFloat(series[date]['3. low']),
          close: parseFloat(series[date]['4. close']),
        })).reverse();
      }),
      catchError(() => of([]))
    );
  }
}