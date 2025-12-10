import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Symbol } from './symbol';

describe('Symbol', () => {
  let component: Symbol;
  let fixture: ComponentFixture<Symbol>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Symbol]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Symbol);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
