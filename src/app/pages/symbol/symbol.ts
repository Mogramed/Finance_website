import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { distinctUntilChanged, map, shareReplay, Observable } from 'rxjs';

@Component({
  selector: 'app-symbol',
  imports: [CommonModule],
  templateUrl: './symbol.html',
  styleUrl: './symbol.scss',
})
export class Symbol {
  symbol$: Observable<string>;

  constructor(private readonly route: ActivatedRoute) {
    this.symbol$ = this.route.paramMap.pipe(
      map((p) => (p.get('symbol') ?? '').toUpperCase()),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}
