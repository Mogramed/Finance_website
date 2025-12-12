import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { firstValueFrom, take } from 'rxjs';
import { MarketStore } from './market.store';
import { timer, of } from 'rxjs';
import { map, distinctUntilChanged, switchMap } from 'rxjs/operators';


function readLS(key: string) {
  return JSON.parse(localStorage.getItem(key) ?? 'null');
}

describe('MarketStore (Vitest)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    localStorage.clear();
  });

  it('starts with defaults (or persisted) and exposes a snapshot', () => {
    const store = TestBed.inject(MarketStore);

    const snap = (store as any).snapshotSubject?.value ?? null;
    expect(snap).toBeTruthy();
    expect(Array.isArray(snap.watchlist)).toBe(true);
    expect(snap.settings.refreshMs).toBeGreaterThan(0);
  });

  it('adds/removes symbols (uppercase, no duplicates)', () => {
    const store = TestBed.inject(MarketStore);

    store.addSymbol('nvda');
    store.addSymbol('NVDA'); // duplicate
    store.addSymbol(' msft ');

    const s1 = (store as any).snapshotSubject.value;
    const symbols: string[] = s1.watchlist.map((w: any) => w.symbol);

    expect(symbols).toContain('NVDA');
    expect(symbols.filter((x) => x === 'NVDA').length).toBe(1);
    expect(symbols).toContain('MSFT');

    store.removeSymbol('nvda');
    const s2 = (store as any).snapshotSubject.value;
    expect(s2.watchlist.map((w: any) => w.symbol)).not.toContain('NVDA');
  });

  it('updates filters and reflects in filteredWatchlistVm$', async () => {
    const store = TestBed.inject(MarketStore);

    store.reset();
    store.addSymbol('AAAA');
    store.addSymbol('BBBB');

    store.setQuery('BBB');

    const items = await firstValueFrom(store.filteredWatchlistVm$.pipe(take(1)));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((x) => x.symbol.includes('BBB'))).toBe(true);
  });

  it('persists watchlist + settings into localStorage', fakeAsync(() => {
    const store = TestBed.inject(MarketStore);

    store.reset();
    store.addSymbol('NVDA');
    store.setRefreshMs(900);

    tick(0); // laisse passer la persistance

    const saved = readLS('rmd.market.v1');
    expect(saved).toBeTruthy();
    expect(saved.watchlist.some((w: any) => w.symbol === 'NVDA')).toBe(true);
    expect(saved.settings.refreshMs).toBe(900);
  }));

    it('liveTick$ reacts to refreshMs changes (switchMap(timer))', fakeAsync(() => {
    const store = TestBed.inject(MarketStore);

    let ticksCount = 0;
    const sub = (store as any).liveTick$.subscribe(() => ticksCount++);

    tick(0);
    expect(ticksCount).toBeGreaterThan(0);

    const before = ticksCount;
    store.setRefreshMs(1000);
    tick(0);

    tick(2100);
    expect(ticksCount).toBeGreaterThan(before);

    sub.unsubscribe();
  }));
});
