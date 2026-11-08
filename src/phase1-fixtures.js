const demoStart = (date, track, number, distanceM, method, lane, driver, placing, kmTime, x200, x400) => ({
  date, track, raceNumber: number, distanceM, startMethod: method, lane,
  driverName: driver, placing, kmTime, first200: x200, last400: x400
});

const histories = [
  [
    demoStart('2026-05-23', 'Solvalla', 7, 2140, 'Auto', 4, 'Mikael Andersson', '1', '1.12,3', '1.08,2', '1.10,5'),
    demoStart('2026-05-09', 'Bergsåker', 4, 2140, 'Auto', 2, 'Mikael Andersson', '3G', '1.13,1', null, '1.11,0'),
    demoStart('2026-04-25', 'Åby', 9, 2640, 'Volt', 3, 'Erik Holm', '2', '1.14,4', null, null),
    demoStart('2026-04-11', 'Romme', 6, 2140, 'Auto', 5, 'Mikael Andersson', 'GD', null, null, null),
    demoStart('2026-03-28', 'Solvalla', 5, 2140, 'Auto', 1, 'Mikael Andersson', '5', '1.13,8', null, null)
  ],
  [
    demoStart('2026-05-30', 'Jägersro', 3, 1640, 'Auto', 10, 'Sara Lindqvist', '2', '1.11,7', '1.09,0', '1.10,8'),
    demoStart('2026-05-16', 'Halmstad', 8, 2140, 'Auto', 11, 'Sara Lindqvist', '4', '1.13,2', null, null),
    demoStart('2026-05-02', 'Åby', 2, 2140, 'Volt', 6, 'Oskar Nyström', '1', '1.14,0', null, '1.11,9')
  ],
  [
    demoStart('2026-05-17', 'Umåker', 2, 2140, 'Volt', 8, 'Linnea Berg', 'GD', null, null, null),
    demoStart('2026-05-03', 'Boden', 5, 2140, 'Auto', 3, 'Linnea Berg', '6', '1.15,0', null, null)
  ],
  [
    demoStart('2026-05-24', 'Solvalla', 6, 2140, 'Auto', 6, 'Anders Ek', '3', '1.13,0', null, '1.10,9'),
    demoStart('2026-05-10', 'Romme', 1, 2140, 'Auto', 7, 'Anders Ek', '1', '1.12,8', '1.09,2', null),
    demoStart('2026-04-26', 'Åby', 4, 2640, 'Volt', 2, 'Johan Nordin', '2', '1.14,7', null, null),
    demoStart('2026-04-12', 'Solvalla', 8, 2140, 'Auto', 9, 'Anders Ek', '5', '1.13,9', null, null),
    demoStart('2026-03-29', 'Bergsåker', 3, 2140, 'Auto', 5, 'Anders Ek', '4', '1.14,1', null, null)
  ]
];

const stat = (wins, starts) => ({
  wins, starts, winRate: starts ? wins / starts : null
});

const horses = [
  {
    horseId: 'demo-horse-1', horseName: 'Silver Atlas', startNumber: 4, lane: 4,
    driverId: 'demo-driver-1', driverName: 'Mikael Andersson', trainerId: 'demo-trainer-1',
    formScore: 82, first200: '1.08,2', last400: '1.10,5', betPercent: 18.2,
    form: ['1', '3G', '2', 'GD', '5'], history: histories[0],
    stats: {
      track: stat(2, 8), lane: { ...stat(3, 12), label: 'Framspår auto' },
      distance: stat(4, 15), method: stat(7, 29), driver: stat(5, 18),
      twelveMonths: stat(3, 11), gallop: { starts: 25, gallops: 3, rate: 3 / 25 },
      driverForm: 84, trainerForm: 79
    }
  },
  {
    horseId: 'demo-horse-2', horseName: 'Fable Morningstar', startNumber: 7, lane: 10,
    driverId: 'demo-driver-2', driverName: 'Sara Lindqvist', trainerId: 'demo-trainer-2',
    formScore: null, first200: null, last400: '1.10,8', betPercent: 6.4,
    form: ['2', '4', '1', '3', '2'], history: histories[1],
    stats: {
      track: stat(1, 3), lane: { ...stat(1, 9), label: 'Bakspår auto' },
      distance: stat(0, 5), method: stat(2, 16), driver: stat(2, 8),
      twelveMonths: stat(1, 6), gallop: { starts: 13, gallops: 0, rate: 0 },
      driverForm: 71, trainerForm: null
    }
  },
  {
    horseId: 'demo-horse-3', horseName: 'Northbound Echo', startNumber: 2, lane: 8,
    driverId: 'demo-driver-3', driverName: 'Linnea Berg', trainerId: 'demo-trainer-3',
    formScore: 46, first200: null, last400: null, betPercent: null,
    form: ['GD', '6'], history: histories[2],
    stats: {
      track: stat(0, 1), lane: { ...stat(0, 4), label: 'Övriga spår volt' },
      distance: stat(0, 2), method: stat(1, 7), driver: stat(0, 3),
      twelveMonths: stat(0, 2), gallop: { starts: 2, gallops: 1, rate: 0.5 },
      driverForm: null, trainerForm: null
    }
  },
  {
    horseId: 'demo-horse-4', horseName: 'Amber Archive', startNumber: 1, lane: 6,
    driverId: 'demo-driver-4', driverName: 'Anders Ek', trainerId: 'demo-trainer-4',
    formScore: 74, first200: '1.09,2', last400: null, betPercent: 12.7,
    form: ['3', '1', '5', '2', '4'], history: histories[3],
    stats: {
      track: stat(3, 10), lane: { ...stat(2, 10), label: 'Framspår auto' },
      distance: stat(5, 22), method: stat(6, 31), driver: stat(3, 12),
      twelveMonths: stat(2, 9), gallop: { starts: 19, gallops: 2, rate: 2 / 19 },
      driverForm: 78, trainerForm: 81
    }
  }
];

const round = (id, gameType, roundDate, trackNames, baseDistance, startMethod, index, demoHorses) => ({
  id, gameType, roundDate, trackNames, scheduledStartAt: `${roundDate}T15:00:00+02:00`,
  betStopAt: `${roundDate}T15:00:00+02:00`, roundStatus: 'upcoming', source: 'synthetic',
  legs: Array.from({ length: 8 }, (_, i) => ({
    number: i + 1,
    raceNumber: i + 1,
    raceId: `${id}-race-${i + 1}`,
    trackName: i % 3 === 0 ? trackNames.split(' · ')[1] || trackNames : trackNames.split(' · ')[0],
    distanceM: i % 3 === 0 ? 2640 : baseDistance,
    startMethod: i === 2 ? 'Volt' : i === 5 && index ? 'Monté' : startMethod,
    activeEntries: 3,
    entries: [
      { ...demoHorses[(i + index) % demoHorses.length], startNumber: 1, lane: 1 + (i % 8) },
      { ...demoHorses[(i + 1 + index) % demoHorses.length], startNumber: 4, lane: 9 + (i % 4) },
      { ...demoHorses[(i + 2 + index) % demoHorses.length], startNumber: 9, lane: 3 + (i % 6) }
    ]
  }))
});

function stockholmToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftHistoryRows(dateText) {
  const anchor = '2026-06-01';
  const delta = Math.round((new Date(`${dateText}T12:00:00Z`) - new Date(`${anchor}T12:00:00Z`)) / 86400000);
  return histories.map((rows) => rows.map((row) => ({ ...row, date: addDays(row.date, delta) })));
}

function fastest(rows, key) {
  return rows.map((row) => row[key]).filter(Boolean).sort((a, b) => {
    const seconds = (text) => {
      const match = String(text).match(/(?:1[.:])?(\d{2})[,.](\d)/);
      return match ? Number(match[1]) + Number(match[2]) / 10 : Infinity;
    };
    return seconds(a) - seconds(b);
  })[0] || null;
}

function demoHorsesFor(dateText) {
  const shifted = shiftHistoryRows(dateText);
  return horses.map((horse, index) => {
    const history = shifted[index];
    return {
      ...horse,
      history,
      form: history.slice(0, 5).map((row) => row.placing),
      first200: fastest(history, 'first200'),
      last400: fastest(history, 'last400')
    };
  });
}

function nextWeekday(dateText, targetDay) {
  const current = new Date(`${dateText}T12:00:00Z`).getUTCDay();
  const delta = (targetDay - current + 7) % 7 || 7;
  return addDays(dateText, delta);
}

export function createPhase1DemoRounds(asOfDate = stockholmToday()) {
  const horsesForDate = demoHorsesFor(asOfDate);
  const v85Date = nextWeekday(asOfDate, 6);
  const v86Date = nextWeekday(asOfDate, 3);
  return [
    round(`demo-v85-${v85Date}`, 'V85', v85Date, 'Solvalla · Åby', 2140, 'Auto', 0, horsesForDate),
    round(`demo-v86-${v86Date}`, 'V86', v86Date, 'Bergsåker · Jägersro', 1640, 'Auto', 1, horsesForDate)
  ];
}

export const PHASE1_DEMO_ROUNDS = Object.freeze(createPhase1DemoRounds());

export function createPhase1DemoHistoricalRound(asOfDate = stockholmToday()) {
  const date = addDays(asOfDate, -30);
  const sourceRound = createPhase1DemoRounds(asOfDate)[0];
  return {
    ...sourceRound,
    id: `demo-v85-historical-${date}`,
    roundDate: date,
    scheduledStartAt: `${date}T15:00:00+02:00`,
    betStopAt: `${date}T15:00:00+02:00`,
    roundStatus: 'settled',
    historical: true,
    legs: sourceRound.legs.map(leg => ({
      ...leg, raceId: `demo-v85-historical-${date}-race-${leg.number}`, entries: undefined
    }))
  };
}

export const PHASE1_DEMO_HISTORICAL_ROUND = Object.freeze(createPhase1DemoHistoricalRound());

const picks = (sets) => sets.map((set) => [...set]);
const standardPicks = picks([[1], [2, 4], [3, 6], [1, 5], [2, 7], [4, 8], [3, 9], [1, 6]]);
const noSpikePicks = picks([[1, 2], [2, 4], [3, 6], [1, 5], [2, 7], [4, 8], [3, 9], [1, 6]]);
const manySpikePicks = picks([[1], [2], [3, 6], [5], [2, 7], [4], [3, 9], [6]]);

const winningNumbers = [1, 4, 6, 5, 2, 8, 9, 6];
const demoSystem = (id, roundId, gameType, name, legs, { state = 'settled', payout = 0, historical = false } = {}) => {
  const rowCount = legs.reduce((sum, leg) => sum * leg.length, 1);
  const stakeSek = rowCount * (gameType === 'V85' ? 0.5 : 0.25);
  return {
    id, roundId, gameType, roundDate: historical ? '2025-11-08' : roundId.includes('v86') ? '2026-06-24' : '2026-06-20',
    trackNames: historical ? 'Åby' : roundId.includes('v86') ? 'Bergsåker · Jägersro' : 'Solvalla · Åby',
    systemName: name, legs, rowCount, stakeSek, settlementState: state,
    payoutSek: state === 'settled' ? payout : null,
    netSek: state === 'settled' ? payout - stakeSek : null,
    winnerNumbers: state === 'settled' ? winningNumbers : null,
    source: 'synthetic',
    correctLegs: state === 'settled' ? legs.reduce((n, leg, i) => n + (leg.includes(winningNumbers[i]) ? 1 : 0), 0) : null,
    historical, registrationType: historical ? 'Historisk registrering' : 'Registrerad'
  };
};

const baseDemoSystems = [
  demoSystem('demo-sys-negative', 'demo-v85-ledger-example', 'V85', 'Ekonomiexempel · negativt netto',
    picks([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1], [1], [1]]), { payout: 8750 }),
  demoSystem('demo-sys-v85-win', 'demo-v85-2026-06-20', 'V85', 'Lördagsraden', standardPicks, { payout: 1260 }),
  demoSystem('demo-sys-v85-loss', 'demo-v85-2026-06-20', 'V85', 'Extra gardering', noSpikePicks, { payout: 0 }),
  demoSystem('demo-sys-v86-zero', 'demo-v86-settled', 'V86', 'Avslutad onsdagsrad', noSpikePicks, { payout: 64 }),
  demoSystem('demo-sys-v86-pending', 'demo-v86-2026-06-24', 'V86', 'Onsdagsrad', manySpikePicks, { state: 'pending' }),
  demoSystem('demo-sys-historical', 'demo-v85-historical-2025-11-08', 'V85', 'Historisk registrering', manySpikePicks, { payout: 0, historical: true })
];

export function createPhase1DemoSystems(rounds = PHASE1_DEMO_ROUNDS, asOfDate = stockholmToday()) {
  const v86 = rounds.find((roundItem) => roundItem.gameType === 'V86');
  const historicalDate = addDays(asOfDate, -30);
  return baseDemoSystems.map((system) => {
    if (system.historical) {
      return { ...system, roundId: `demo-v85-historical-${historicalDate}`, roundDate: historicalDate };
    }
    if (system.id === 'demo-sys-negative') {
      return { ...system, roundDate: historicalDate, trackNames: 'Åby' };
    }
    if (system.id === 'demo-sys-v85-win' || system.id === 'demo-sys-v85-loss') {
      const settledDate = addDays(asOfDate, -7);
      return { ...system, roundId: `demo-v85-settled-${settledDate}`, roundDate: settledDate, trackNames: 'Solvalla · Åby' };
    }
    if (system.id === 'demo-sys-v86-zero') {
      const settledDate = addDays(asOfDate, -14);
      return { ...system, roundId: `demo-v86-settled-${settledDate}`, roundDate: settledDate, trackNames: 'Bergsåker · Jägersro' };
    }
    if (system.id === 'demo-sys-v86-pending') {
      return { ...system, roundId: v86?.id || system.roundId, roundDate: v86?.roundDate || system.roundDate, trackNames: v86?.trackNames || system.trackNames };
    }
    return system;
  });
}

export const PHASE1_DEMO_SYSTEMS = Object.freeze(createPhase1DemoSystems());

export const PHASE1_DEMO_HORSE_NOTES = Object.freeze([
  { id: 'demo-note-1', horseId: 'demo-horse-1', raceEntryId: null, text: 'Syntetisk exempelanteckning: stark avslutning på liknande distans.', createdAt: '2026-05-25T10:00:00.000Z', source: 'synthetic' }
]);
