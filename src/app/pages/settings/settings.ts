import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, startWith } from 'rxjs';
import { MarketStore } from '../../core/store/market.store';

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
  
  // Juste le refresh rate
  readonly refreshCtrl = new FormControl(15000, { nonNullable: true });

  constructor() {
    // Initialisation
    this.settings$.pipe(takeUntilDestroyed()).subscribe(s => {
      this.refreshCtrl.setValue(s.refreshMs, { emitEvent: false });
    });

    // Sauvegarde auto
    this.refreshCtrl.valueChanges.pipe(
      startWith(this.refreshCtrl.value),
      debounceTime(500),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((val) => this.store.setRefreshMs(val));
  }
}