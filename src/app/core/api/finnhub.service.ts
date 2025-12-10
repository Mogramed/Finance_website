import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface FinnhubQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // percent change
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;  // unix timestamp (seconds)
}

export interface FinnhubSearchResult {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

export interface FinnhubSearchResponse {
  count: number;
  result: FinnhubSearchResult[];
}

@Injectable({ providedIn: 'root' })
export class FinnhubService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'https://finnhub.io/api/v1';

  quote(symbol: string, token: string): Observable<FinnhubQuote> {
    return this.http.get<FinnhubQuote>(`${this.baseUrl}/quote`, {
      params: { symbol, token },
    });
  }

  search(q: string, token: string): Observable<FinnhubSearchResponse> {
    return this.http.get<FinnhubSearchResponse>(`${this.baseUrl}/search`, {
      params: { q, token },
    });
  }
}
    