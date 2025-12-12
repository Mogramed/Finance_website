import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Invest } from './invest';

describe('Invest', () => {
  let component: Invest;
  let fixture: ComponentFixture<Invest>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Invest]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Invest);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
