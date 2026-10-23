/**
 * Each entry describes one dashboard metric cell.
 *
 * Fields:
 *   id         — unique string key; stored in localStorage to represent order/visibility
 *   label      — display label shown in the cell header
 *   required   — if true: always visible, freely reorderable, but cannot be removed by the user
 *   available  — (ds) => bool — return false to hide this metric from the dashboard and the
 *                Settings configurator pool. ds is either the useDashboardState() result
 *                (in DashboardSidebar) or machine.value.status (in Settings) — both share
 *                the same shape for fields used by available guards.
 *   getValue   — (ds) => string — primary displayed value
 *   getTarget  — (ds) => string|null — secondary target value (shown as "/target unit"). Omit if none.
 *   unit       — string appended to the target value (e.g. ' bar', '°C')
 *   adjustable — (ds) => bool — whether +/- buttons are rendered
 *   disabled   — (ds) => bool — whether the rendered +/- buttons are disabled. Omit if never
 *                disabled. Defaults to false.
 *   onDecrease — (ds) => function — handler for the minus button. Omit if not adjustable.
 *   onIncrease — (ds) => function — handler for the plus button. Omit if not adjustable.
 *   onTap      — (ds) => function|undefined — makes the value tappable (weight: tap to tare).
 *                Omit if never tappable.
 */
export const METRIC_DEFINITIONS = [
  {
    id: 'pressure',
    label: 'Pressure',
    required: false,
    available: () => true,
    getValue: ds => (ds.currentPressure ?? 0).toFixed(1),
    getTarget: ds => (ds.targetPressure ?? 0).toFixed(1),
    unit: ' bar',
    adjustable: () => false,
  },
  {
    id: 'flow',
    label: 'Flow',
    required: false,
    available: () => true,
    // Value is the plain number; the unit lives only in the small target line
    // ("/ 5.0 ml/s" at text-xs), exactly like every other cell. Embedding
    // "ml/s" in the value rendered it at text-4xl (the value's size), spilling
    // the cell onto a second row.
    getValue: ds => (ds.currentFlow ?? 0).toFixed(1),
    getTarget: ds => (ds.targetFlow > 0 ? (ds.targetFlow ?? 0).toFixed(1) : null),
    unit: ' ml/s',
    adjustable: () => false,
  },
  {
    id: 'temp',
    label: 'Temp',
    required: true,
    available: () => true,
    getValue: ds => `${(ds.currentTemperature ?? 0).toFixed(1)}°`,
    getTarget: ds => (ds.targetTemperature ?? 0).toFixed(0),
    unit: '°C',
    adjustable: () => true,
    disabled: ds => (ds.isBrewing && ds.isActive) || ds.mode === 0,
    onDecrease: ds => ds.lowerTemp,
    onIncrease: ds => ds.raiseTemp,
  },
  {
    id: 'pumppower',
    label: 'Pump Power',
    required: false,
    available: () => true,
    getValue: ds => `${Math.round(ds.currentPumpPower ?? 0)}%`,
    getTarget: () => null,
    unit: '%',
    adjustable: () => false,
  },
  {
    id: 'heaterpower',
    label: 'Heater Power',
    required: false,
    available: () => true,
    getValue: ds => `${Math.round(ds.mode === 0 ? 0 : (ds.currentBoilerPower ?? 0))}%`,
    getTarget: () => null,
    unit: '%',
    adjustable: () => false,
  },
  {
    id: 'puckresistance',
    label: 'Puck Resistance',
    required: false,
    available: () => true,
    getValue: ds => {
      const r = ds.currentPuckResistance ?? 0;
      return r > 0 && r < 100 ? `${r.toFixed(2)} s·√bar/mL` : '—';
    },
    getTarget: () => null,
    adjustable: () => false,
  },
  {
    id: 'puckflow',
    label: 'Puck Flow',
    required: false,
    available: () => true,
    getValue: ds => `${(ds.currentPuckFlow ?? 0).toFixed(1)} ml/s`,
    getTarget: () => null,
    adjustable: () => false,
  },
  {
    id: 'estimatedoutput',
    label: 'Estimated Output',
    required: false,
    available: () => true,
    getValue: ds => {
      const v = ds.currentCoffeeVolume ?? 0;
      return v > 0 ? `${v.toFixed(1)} ml` : '—';
    },
    getTarget: () => null,
    adjustable: () => false,
  },
  {
    id: 'waterlevel',
    label: 'Water Level',
    required: false,
    available: ds => !!ds.tofDistance,
    getValue: ds => (ds.waterLevelPercent !== null ? `${Math.round(ds.waterLevelPercent)}%` : '—'),
    getTarget: () => null,
    unit: '%',
    adjustable: () => false,
  },
  {
    id: 'weight',
    label: 'Weight',
    required: false,
    available: () => true, // always configurable; getValue shows '—' when scale not connected
    getValue: ds => (ds.volumetricAvailable ? `${(ds.currentWeight ?? 0).toFixed(1)}g` : '—'),
    getTarget: ds => (ds.brewTarget && ds.targetWeight != null ? ds.targetWeight.toFixed(0) : null),
    unit: 'g',
    adjustable: ds => ds.volumetricAvailable,
    disabled: ds =>
      (ds.isBrewing && ds.isActive) ||
      ds.mode === 0 ||
      ds.mode === 2 ||
      ds.mode === 3 ||
      ds.mode === 4 ||
      !ds.targetWeight,
    onDecrease: ds => ds.lowerTarget,
    onIncrease: ds => ds.raiseTarget,
    // Tap the weight to tare, like the MANUAL card (user 2026-09-23). Same rule:
    // idle only (the firmware refuses a tare mid-shot too, WebUIPlugin
    // req:tare), with the scale connected or a finished shot to reset (the
    // firmware's tare also clears the finished shot).
    onTap: ds =>
      ds.tare && !ds.isActive && (ds.bluetoothConnected || ds.isFinished) ? ds.tare : undefined,
  },
];
