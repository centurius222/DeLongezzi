
#ifndef CONSTANTS_H
#define CONSTANTS_H

#define PING_INTERVAL 2000 // keepalive ping cadence (ms); feeds the controller's connection watchdog
#define PROGRESS_INTERVAL 100
#define HOT_WATER_SAFETY_DURATION_MS 120000
#define STEAM_SAFETY_DURATION_MS 600000
#define BREW_MIN_DURATION_MS 5000
#define BREW_MAX_DURATION_MS 300000
#define BREW_SAFETY_DURATION_MS BREW_MAX_DURATION_MS
#define BREW_MIN_VOLUMETRIC 5.0
#define BREW_MAX_VOLUMETRIC 250.0
#define DEFAULT_STANDBY_TIMEOUT_MS 900000
#define MIN_TEMP 0
#define MAX_TEMP 160
#define DEFAULT_TEMPERATURE_OFFSET 0
#define DEFAULT_PRESSURE_SCALING 16.0f
#define DEFAULT_PID "58.397,1.027,249.055,0.0"
#define DEFAULT_PUMP_MODEL_COEFFS "10.205,5.521"
#define DEFAULT_PUMP_SLIP_COEFFS "0,0,0,0"
#define DEFAULT_MDNS_NAME "delongezzi"
#define DEFAULT_OTA_CHANNEL "latest"
#define DEFAULT_TIMEZONE "Europe/Rome"
#define DEFAULT_HOME_ASSISTANT_TOPIC "homeassistant"
#define DEFAULT_STEAM_PUMP_PERCENTAGE 4.f
#define DEFAULT_STEAM_PUMP_CUTOFF 2.f

// Manual mode. No profile, no phases: the shot runs until you stop it, with
// the safety duration as the only backstop (same cap as brew). Temperature is
// its own persisted setting rather than the selected profile's, so switching
// profiles never moves the manual target.
#define MANUAL_SAFETY_DURATION_MS BREW_MAX_DURATION_MS
#define DEFAULT_TARGET_MANUAL_TEMP 93
#define DEFAULT_MANUAL_PRESSURE 9.0f // user 2026-09-23: start the manual slider at 9 bar (was 2)
#define MANUAL_MIN_PRESSURE 0.0f
#define MANUAL_MAX_PRESSURE 12.0f
#define MANUAL_MAX_WEIGHT 100.0f
// Averaging window for manual mode's displayed flow, in ms. Separate from
// PREDICTIVE_TIME (4000), which smooths the stop prediction: a readout wants
// a shorter window so it tracks what your hand is doing on the pressure.
#define MANUAL_FLOW_WINDOW_MS 1500.0
// How long a finished manual shot keeps taking scale samples. The pump cuts
// early by brewDelay precisely BECAUSE more is still on its way down; without
// this the recorded weight is the weight at the cut, not what is in the cup.
#define MANUAL_SETTLE_MS 3000
// Below this the shot average is not reported. Yield over a fraction of a
// second is arithmetic, not a measurement: an aborted 49ms shot divides out
// to hundreds of g/s and flashes nonsense at you.
#define MANUAL_MIN_AVG_MS 2000
#define WIFI_CONNECT_ATTEMPTS 20

#define DEFAULT_COMMUTATION_GAIN 0.7f
#define DEFAULT_CONVERGENCE_GAIN 1.0f
#define DEFAULT_INTEGRAL_GAIN 0.25f

#define MODE_STANDBY 0
#define MODE_BREW 1
#define MODE_STEAM 2
#define MODE_WATER 3
#define MODE_GRIND 4
#define MODE_MANUAL 5

// Alt Relay / SSR2 Function constants
#define ALT_RELAY_NONE 0
#define ALT_RELAY_GRIND 1
#define ALT_RELAY_STEAM_BOILER 2

#define WIFI_CONNECT_TIMEOUT_MS 30000
#define DEFAULT_WIFI_AP_TIMEOUT_MS 600000
// First-start AP password (user 2026-09-24). It used to be random and visible only
// in the serial log; a fresh board now uses this until the user sets their own.
// 2026-10-22 (build 969): a new value for the public code on GitHub. Boards that already
// saved one keep it: this only fills an empty setting (Controller::setupWifi).
#define DEFAULT_WIFI_AP_PASSWORD "espresso-setup"
#define WIFI_AP_PASSWORD_MIN_LENGTH 8 // WPA2 minimum passphrase length

#endif // CONSTANTS_H
