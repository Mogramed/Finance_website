import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface FinnhubQuote {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
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

export interface FinnhubCandles {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
  s: 'ok' | 'no_data';
}

export interface FinnhubCompanyProfile2 {
  country: string;
  currency: string;
  exchange: string;
  finnhubIndustry: string;
  ipo: string;
  logo: string;
  marketCapitalization: number;
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
}

export interface FinnhubCompanyNewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
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

  profile2(symbol: string, token: string): Observable<FinnhubCompanyProfile2> {
    return this.http.get<FinnhubCompanyProfile2>(`${this.baseUrl}/stock/profile2`, {
      params: { symbol, token },
    });
  }

  candles(symbol: string, resolution: string, from: number, to: number, token: string): Observable<FinnhubCandles> {
    return this.http.get<FinnhubCandles>(`${this.baseUrl}/stock/candle`, {
      params: { symbol, resolution, from: String(from), to: String(to), token },
    });
  }

  companyNews(symbol: string, from: string, to: string, token: string): Observable<FinnhubCompanyNewsItem[]> {
    return this.http.get<FinnhubCompanyNewsItem[]>(`${this.baseUrl}/company-news`, {
      params: { symbol, from, to, token },
    });
  }
}
