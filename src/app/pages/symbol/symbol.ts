import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { distinctUntilChanged, map, shareReplay, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarketStore } from '../../core/store/market.store';

@Component({
  selector: 'app-symbol',
  imports: [CommonModule],
  templateUrl: './symbol.html',
  styleUrl: './symbol.scss',
})
export class Symbol {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(MarketStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly symbol$ = this.route.paramMap.pipe(
    map((p) => (p.get('symbol') ?? '').toUpperCase()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.symbol$
      .pipe(
        tap((sym) => this.store.selectSymbol(sym)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }
}
