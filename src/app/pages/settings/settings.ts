import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LiveMode, MarketStore } from '../../core/store/market.store';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly store = inject(MarketStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly settings$ = this.store.settings$;
  readonly wsStatus$ = this.store.wsStatus$;
  readonly effectiveRefreshMs$ = this.store.effectiveRefreshMs$;

  readonly tokenCtrl = new FormControl('', { nonNullable: true });
  readonly refreshCtrl = new FormControl<number>(1500, { nonNullable: true });
  readonly modeCtrl = new FormControl<LiveMode>('ws', { nonNullable: true });

  constructor() {
    // hydrate UI depuis store
    this.settings$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((s) => {
        this.tokenCtrl.setValue(s.apiToken ?? '', { emitEvent: false });
        this.refreshCtrl.setValue(s.refreshMs, { emitEvent: false });
        this.modeCtrl.setValue(s.liveMode, { emitEvent: false });
      });

    this.tokenCtrl.valueChanges
      .pipe(
        startWith(this.tokenCtrl.value),
        debounceTime(250),
        map((v) => v.trim() || null),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((tok) => this.store.setApiToken(tok));

    this.refreshCtrl.valueChanges
      .pipe(
        startWith(this.refreshCtrl.value),
        debounceTime(150),
        map((ms) => Math.max(500, Number(ms || 1500))),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((ms) => this.store.setRefreshMs(ms));

    this.modeCtrl.valueChanges
      .pipe(
        startWith(this.modeCtrl.value),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((m) => this.store.setLiveMode(m));
  }
}
