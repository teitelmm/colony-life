import { describe, expect, it } from 'vitest';
import { Crew, assignCrew, MEAL_INTERVAL, RECRUIT_INTERVAL, STARVE_DESERT } from '../src/game/Crew';

const run = (crew: Crew, seconds: number, berths: number) => {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += 0.5) events.push(...crew.update(0.5, berths));
  return events;
};

describe('crew assignment', () => {
  it('fills repair orders, then guns, then fishing', () => {
    expect(assignCrew(2, 0, 1)).toEqual({ repairers: 0, gunners: 1, fisher: true, idle: 1 });
    expect(assignCrew(2, 1, 1)).toEqual({ repairers: 1, gunners: 1, fisher: false, idle: 0 });
    expect(assignCrew(2, 2, 3)).toEqual({ repairers: 2, gunners: 0, fisher: false, idle: 0 });
    expect(assignCrew(0, 1, 1).gunners).toBe(0);
  });
});

describe('food and hunger', () => {
  it('eats one ration per hand per meal', () => {
    const c = new Crew(3, 10);
    run(c, MEAL_INTERVAL + 1, 3);
    expect(c.food).toBe(7);
  });

  it('starving crews work slower and eventually desert', () => {
    const c = new Crew(2, 0);
    expect(c.efficiency).toBeLessThan(1);
    const ev = run(c, STARVE_DESERT + 1, 2);
    expect(ev).toContain('deserted');
    expect(c.count).toBe(1);
  });
});

describe('recruiting', () => {
  it('fills empty bunks when there is food', () => {
    const c = new Crew(2, 20);
    const ev = run(c, RECRUIT_INTERVAL + 1, 4);
    expect(ev).toContain('recruited');
    expect(c.count).toBe(3);
  });

  it('does not recruit without a free bunk or food', () => {
    const full = new Crew(2, 20);
    run(full, RECRUIT_INTERVAL * 2, 2);
    expect(full.count).toBe(2);
    const broke = new Crew(2, 2);
    run(broke, RECRUIT_INTERVAL * 2, 6);
    expect(broke.count).toBe(2);
  });

  it('rescued sailors need a bunk', () => {
    const c = new Crew(2, 5);
    expect(c.join(2)).toBe(false);
    expect(c.join(3)).toBe(true);
    expect(c.count).toBe(3);
  });
});
