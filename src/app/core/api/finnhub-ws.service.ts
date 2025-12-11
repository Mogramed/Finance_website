import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  defer,
  distinctUntilChanged,
  filter,
  finalize,
  from,
  map,
  mergeMap,
  shareReplay,
  switchMap,
  tap,
  timer,
  retry,
} from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

export type WsState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface FinnhubWsStatus {
  state: WsState;
  attempts: number;
  lastError?: string;
  lastEventAt?: number; // Date.now()
}

export type FinnhubWsOutgoing =
  | { type: 'subscribe'; symbol: string }
  | { type: 'unsubscribe'; symbol: string };

export interface FinnhubWsTradeDatum {
  p: number; // price
  s: string; // symbol
  t: number; // timestamp (ms)
  v: number; // volume
}

export type FinnhubWsIncoming =
  | { type: 'trade'; data: FinnhubWsTradeDatum[] }
  | { type: string; [k: string]: any };

export interface TradeTick {
  symbol: string;
  price: number;
  ts: number;
  volume: number;
}

@Injectable({ providedIn: 'root' })
export class FinnhubWsService {
  private readonly isBrowser: boolean;

  private readonly token$ = new BehaviorSubject<string | null>(null);
  private ws: WebSocketSubject<FinnhubWsIncoming | FinnhubWsOutgoing> | null = null;

  private readonly desired = new Set<string>(); // symboles qu’on veut écouter (watchlist + page detail)

  private readonly statusSubject = new BehaviorSubject<FinnhubWsStatus>({
    state: 'idle',
    attempts: 0,
  });
  readonly status$ = this.statusSubject.asObservable();

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** Le store appelle ça quand le token change / mode ws on-off */
  setToken(token: string | null) {
    const cleaned = token?.trim() || null;
    this.token$.next(cleaned);
    if (!cleaned) this.disconnect();
  }

  /** Le store appelle ça dès que watchlist/route change */
  setSubscriptions(symbols: string[]) {
    const next = new Set(
      (symbols || [])
        .map((s) => (s ?? '').trim().toUpperCase())
        .filter((s) => !!s)
    );

    // unsubscribe ceux qui ne sont plus désirés
    for (const s of this.desired) {
      if (!next.has(s)) this.send({ type: 'unsubscribe', symbol: s });
    }

    // subscribe nouveaux
    for (const s of next) {
      if (!this.desired.has(s)) this.send({ type: 'subscribe', symbol: s });
    }

    this.desired.clear();
    for (const s of next) this.desired.add(s);

    // si on se connecte/reconnecte plus tard : on resubscribe tout
    if (this.ws && this.statusSubject.value.state === 'open') {
      this.resubscribeAll();
    }
  }

  /** flux brut des messages WS (hot) */
  readonly messages$ = this.token$.pipe(
    distinctUntilChanged(),
    switchMap((token) => {
      if (!this.isBrowser || !token) {
        this.statusSubject.next({ state: 'idle', attempts: 0 });
        return EMPTY;
      }
      return this.connection$(token);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** flux “trade tick” prêt à consommer côté store */
  readonly trade$ = this.messages$.pipe(
    filter((m): m is { type: 'trade'; data: FinnhubWsTradeDatum[] } => m?.type === 'trade' && Array.isArray((m as any).data)),
    mergeMap((m) => from(m.data)),
    map((d) => ({
      symbol: String(d.s || '').toUpperCase(),
      price: Number(d.p),
      ts: Number(d.t),
      volume: Number(d.v),
    })),
    filter((t) => !!t.symbol && Number.isFinite(t.price) && Number.isFinite(t.ts)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ----------------- internals -----------------

  private connection$(token: string): Observable<FinnhubWsIncoming> {
    // defer() => à chaque retry on recrée un WebSocket propre
    return defer(() => {
      const attempts = this.statusSubject.value.attempts + 1;
      this.statusSubject.next({ state: 'connecting', attempts });

      const ws = webSocket<FinnhubWsIncoming | FinnhubWsOutgoing>({
        url: `wss://ws.finnhub.io?token=${encodeURIComponent(token)}`,
        serializer: (v) => JSON.stringify(v),
        deserializer: (e) => JSON.parse((e as MessageEvent).data),
        openObserver: {
          next: () => {
            this.statusSubject.next({ state: 'open', attempts, lastEventAt: Date.now() });
            this.resubscribeAll();
          },
        },
        closeObserver: {
          next: (ev) => {
            this.statusSubject.next({
              state: 'closed',
              attempts,
              lastError: `close code=${(ev as CloseEvent).code} reason=${(ev as CloseEvent).reason || ''}`,
              lastEventAt: Date.now(),
            });
          },
        },
      });

      this.ws = ws;

      return ws.pipe(
        tap({
          next: () => {
            const cur = this.statusSubject.value;
            if (cur.state === 'open') {
              this.statusSubject.next({ ...cur, lastEventAt: Date.now() });
            }
          },
          error: (err) => {
            this.statusSubject.next({
              state: 'error',
              attempts,
              lastError: String(err),
              lastEventAt: Date.now(),
            });
          },
        }),
        finalize(() => {
          if (this.ws === ws) this.ws = null;
        })
      );
    }).pipe(
      // reconnect auto avec backoff (RxJS)
      // si Finnhub ferme ou erreur réseau : retry
      // (pas de promesse, tout est reactive)
      // delay: 1s,2s,3s... max 8s
      // NOTE: si token invalide, Finnhub coupe aussi -> tu verras status.error/closed
      // et tu peux repasser en polling dans settings.
      // eslint-disable-next-line rxjs/no-ignored-error
      // (ce commentaire n’impacte pas le code, c’est juste pédagogique)
      // @ts-ignore
      // retry signature ok en RxJS 7+
      // (Angular 21 -> RxJS 7.x)
      // If TS se plaint, remplace par retryWhen.
      // ----
      // Ici on utilise retry({delay}) :
      // ----
      // @ts-ignore
      (source: Observable<FinnhubWsIncoming>) =>
        source.pipe(
          // @ts-ignore
          retry({
            delay: (_err: unknown, retryCount: number) => timer(Math.min(1000 * retryCount, 8000)),
          })
        )
    ) as unknown as Observable<FinnhubWsIncoming>;
  }

  private send(msg: FinnhubWsOutgoing) {
    if (!this.ws || this.statusSubject.value.state !== 'open') return;
    try {
      this.ws.next(msg);
    } catch {
      // ignore
    }
  }

  private resubscribeAll() {
    if (!this.ws || this.statusSubject.value.state !== 'open') return;
    for (const s of this.desired) this.send({ type: 'subscribe', symbol: s });
  }

  private disconnect() {
    try {
      this.ws?.complete();
    } catch {
      // ignore
    } finally {
      this.ws = null;
    }
  }
}

