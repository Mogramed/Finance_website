import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// --- INTERFACES ---

export interface StockCandle {
  c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string;
}

export interface Quote {
  c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number;
}

export interface FinnhubCompanyProfile2 {
  country: string; currency: string; exchange: string; ipo: string; marketCapitalization: number;
  name: string; phone: string; shareOutstanding: number; ticker: string; weburl: string; logo: string; finnhubIndustry: string;
}

export interface FinnhubCompanyNewsItem {
  category: string; datetime: number; headline: string; id: number; image: string; related: string; source: string; summary: string; url: string;
}

export interface FinnhubSearchResponse {
  count: number;
  result: FinnhubSearchResult[];
}

export interface FinnhubSearchResult {
  description: string; displaySymbol: string; symbol: string; type: string;
}

// Interface pour les stats fondamentales
export interface FinnhubMetrics {
  metric: {
    "10DayAverageTradingVolume": number;
    "52WeekHigh": number;
    "52WeekLow": number;
    "marketCapitalization": number;
    "beta": number;
    "peRatio": number;
    "eps": number;
    "dividendYield": number;
  };
}

// Interface pour le Market Overview (Indices globaux)
export interface MarketItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

// --- SERVICE ---

@Injectable({
  providedIn: 'root'
})
export class FinnhubService {
  private http = inject(HttpClient);
  // Connection au serveur Python local
  private readonly baseUrl = 'http://127.0.0.1:5000'; 

  // --- METHODES ---

  quote(symbol: string, token?: string | null): Observable<Quote> {
    return this.http.get<Quote>(`${this.baseUrl}/quote`, { params: { symbol } });
  }

  profile2(symbol: string, token?: string | null): Observable<FinnhubCompanyProfile2> {
    return this.http.get<FinnhubCompanyProfile2>(`${this.baseUrl}/stock/profile2`, { params: { symbol } });
  }

  search(q: string, token?: string | null): Observable<FinnhubSearchResponse> {
    return this.http.get<FinnhubSearchResponse>(`${this.baseUrl}/search`, { params: { q } });
  }

  companyNews(symbol: string, from: string, to: string, token?: string | null): Observable<FinnhubCompanyNewsItem[]> {
    return this.http.get<FinnhubCompanyNewsItem[]>(`${this.baseUrl}/company-news`, { params: { symbol } });
  }

  candles(symbol: string, resolution: string, from: number, to: number, token?: string | null): Observable<StockCandle> {
    return this.http.get<StockCandle>(`${this.baseUrl}/stock/candle`, {
      params: { symbol, resolution, from: from.toString(), to: to.toString() }
    });
  }

  metrics(symbol: string): Observable<FinnhubMetrics> {
    return this.http.get<FinnhubMetrics>(`${this.baseUrl}/stock/metric`, {
      params: { symbol }
    });
  }

  // C'est cette méthode qui posait problème (elle doit être DANS la classe)
  getMarketOverview(): Observable<MarketItem[]> {
    return this.http.get<MarketItem[]>(`${this.baseUrl}/market/overview`);
  }
}