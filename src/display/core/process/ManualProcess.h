#ifndef MANUALPROCESS_H
#define MANUALPROCESS_H

#include <algorithm>
#include <cmath>
#include <display/core/constants.h>
#include <display/core/predictive.h>
#include <display/core/process/Process.h>
#include <display/models/profile.h>

/**
 * Manual mode: no profile, no phases.
 *
 * The shot runs until the user stops it, or until MANUAL_SAFETY_DURATION_MS as
 * a backstop. Optionally it also stops at a weight target from the Bluetooth
 * scale, with the same overshoot compensation BrewProcess uses.
 *
 * Shaped after PumpProcess (stateless, no profile) rather than BrewProcess,
 * because a profile's phase timeline would end the shot behind the user's back
 * — the whole point of manual is that only the stop button ends it.
 *
 * The pump is NOT driven through getPumpValue(): Controller::updateControl()
 * sees MODE_MANUAL and sends a live pressure target instead. See
 * MANUAL_MODE_PLAN.md.
 */
class ManualProcess : public Process {
  public:
    /**
     * @param weightTarget grams to stop at; <= 0 means run until stopped.
     * @param brewDelay    ms of flow that continues after the pump cuts, used
     *                     to stop early. Comes from settings.getBrewDelay(),
     *                     the same self-calibrating value profile shots learn.
     */
    explicit ManualProcess(double weightTarget = 0.0, double brewDelay = 0.0,
                           unsigned long duration = MANUAL_SAFETY_DURATION_MS)
        : weightTarget(weightTarget), brewDelay(brewDelay), duration(duration) {
        started = millis();
    }

    // Update the stop target on a RUNNING shot. Controller reads the target once
    // when the process is built (activate), so arming the stop-at-weight
    // mid-shot never took effect — the shot ran to the backstop with the old
    // target of 0. This setter lets setManualWeightTarget() re-arm a live shot.
    void setWeightTarget(double grams) { weightTarget = grams; }

    // No brew valve on this build, and manual never drives the alt relay.
    bool isRelayActive() override { return false; }

    bool isAltRelayActive() override { return false; }

    // Unused: updateControl() drives the pump by pressure in MODE_MANUAL.
    float getPumpValue() override { return 0.0f; }

    void progress() override {
        // Stateless — isActive() derives everything it needs on demand.
    }

    void updateVolume(double volume) override {
        // Yield is measured from the weight at the FIRST sample, not from the
        // scale's absolute reading. activate() does tare, but that is an
        // unacknowledged BLE write to someone else's firmware — when it does not
        // land, an absolute comparison sees the previous pour still sitting on
        // the platform, decides the target is already met and ends the shot in
        // milliseconds. Subtracting a baseline makes a missed tare cost nothing:
        // if the tare DID land the first sample is ~0 and this changes nothing.
        if (!haveBaseline) {
            baseline = volume;
            haveBaseline = true;
        } else if (!ended && millis() - started < 3000 && volume < baseline - 2.0 && std::fabs(volume) < 1.5) {
            // The start tare landed after the first reading (audit S2-M3): the reading
            // dropped to about 0, so count from there, or the yield stayed below zero and
            // the weight stop never fired.
            baseline = volume;
        }
        // After the stop the settle window only catches the last drips. A sudden drop then
        // means the cup was lifted (or the scale tared): keep the shot's weight from before
        // it. Lifting the cup within the window used to send the weight below zero and wipe
        // the "g/s avg" (shot #13, 2026-10-09). History uses the same 5 g rule.
        if (ended) {
            if (cupLifted) {
                return;
            }
            if (volume - baseline < currentVolume - MANUAL_CUP_LIFT_DROP_G) {
                cupLifted = true;
                return;
            }
        }
        currentVolume = volume - baseline;
        volumetricRateCalculator.addMeasurement(currentVolume);
        flowRateCalculator.addMeasurement(currentVolume);
    }

    /**
     * Live flow in g/s, MEASURED from the scale rather than modelled from the
     * pump.
     *
     * The panel's flow figure normally comes from the controller half's pump
     * model, but PressureController::getCoffeeFlowRate() is gated on the brew
     * valve being open and this build has no valve fitted, so it reports a hard
     * zero for the entire shot. The scale is already streaming weight for the
     * stop target; its slope is the flow, and it is the more honest number
     * anyway — what is landing in the cup, not what the pump thinks it is
     * pushing.
     *
     * Its own window, shorter than the stop prediction's: 4s of linear fit is
     * the right smoothing for deciding when to cut the pump, but as a readout
     * it trails reality by about half the window, and lagging feedback is
     * useless in the one mode whose whole point is reacting to what you see.
     *
     * ONCE THE SHOT ENDS this returns the shot AVERAGE instead — yield over
     * elapsed. The instantaneous figure is what you ride the pressure against,
     * but the moment the pump cuts it decays to zero within one window: the
     * honest answer to "how fast is coffee landing right now", and a useless
     * thing to leave on screen. The average is the number worth reading
     * afterwards, and it can be checked against the weight and the time either
     * side of it on the panel. It creeps up through the settle window as the
     * last of the shot lands, then holds. The panel relabels to "g/s avg" so
     * the change of meaning is visible rather than silent.
     */
    double getFlowRate() const {
        if (!ended) {
            return flowRateCalculator.getRate() * 1000.0;
        }
        const unsigned long ms = finished - started;
        // Yield over a fraction of a second is arithmetic, not a measurement.
        if (ms < MANUAL_MIN_AVG_MS || currentVolume <= 0.0) {
            return 0.0;
        }
        return currentVolume * 1000.0 / static_cast<double>(ms);
    }

    bool isActive() override {
        // Latched: once a shot is over it stays over. Without this a scale that
        // dips below the target — noise, or lifting the cup — would read as
        // active again, resetting the end time and the frozen shot figures.
        if (ended) {
            return false;
        }
        // Wrap-safe across the ~49d millis() rollover.
        if (millis() - started >= duration) {
            return finish(PhaseExitReason::SAFETY);
        }
        if (weightTarget <= 0.0) {
            return true; // no target: only the stop button ends this
        }
        // Stop early by what will still flow after the pump cuts. Same maths as
        // BrewProcess::currentPhaseExitReason(), including the 8 g clamp that
        // stops a noisy rate estimate from ending the shot prematurely.
        double volume = currentVolume;
        if (volume > 0.0) {
            const double predictedAddedVolume = std::clamp(volumetricRateCalculator.getRate() * brewDelay, 0.0, 8.0);
            volume += predictedAddedVolume;
        }
        return volume < weightTarget ? true : finish(PhaseExitReason::TARGET_VOLUMETRIC);
    }

    // NOT simply !isActive(). The process stays incomplete for a settle window
    // after the pump cuts, because Controller only forwards scale measurements
    // to a process while !isComplete() — and what was already in the shower
    // screen and the basket is still landing. That is the very volume brewDelay
    // stopped early for, so without the wait the recorded weight is the weight
    // AT the cut and the shot average is computed over a numerator that
    // understates the yield. BrewProcess does the same thing for PREDICTIVE_TIME
    // to measure its own overshoot.
    bool isComplete() override { return !isActive() && millis() - finished >= MANUAL_SETTLE_MS; }

    int getType() override { return MODE_MANUAL; }

    // The stop button never reaches the process — Controller::deactivateLocked
    // just moves it aside — so without this a manually stopped shot would still
    // report itself active and its timer would keep counting.
    void end() override {
        if (!ended) {
            finish(PhaseExitReason::ABORTED);
        }
    }

    // Elapsed shot time, frozen at the end so the UI shows the final figure
    // rather than a clock that keeps running.
    unsigned long getElapsed() { return (ended ? finished : millis()) - started; }

    double getCurrentVolume() const { return currentVolume; }
    double getWeightTarget() const { return weightTarget; }
    double getBrewDelay() const { return brewDelay; }
    // Why the shot ended (Shot History): weight target, safety backstop or the stop button.
    PhaseExitReason getExitReason() const { return exitReason; }

  private:
    // Stamps the end time and latches. Returns false so the stop conditions in
    // isActive() can `return finish(reason);` and read as what they are.
    bool finish(PhaseExitReason reason) {
        ended = true;
        finished = millis();
        exitReason = reason;
        return false;
    }

    double weightTarget;
    double brewDelay;
    unsigned long duration;
    unsigned long started = 0;
    unsigned long finished = 0;
    bool ended = false;
    bool cupLifted = false; // a drop after the stop froze the shot's weight
    static constexpr double MANUAL_CUP_LIFT_DROP_G = 5.0;
    PhaseExitReason exitReason = PhaseExitReason::NONE;
    double currentVolume = 0.0;
    double baseline = 0.0;
    bool haveBaseline = false;
    VolumetricRateCalculator volumetricRateCalculator{PREDICTIVE_TIME};
    VolumetricRateCalculator flowRateCalculator{MANUAL_FLOW_WINDOW_MS};
};

#endif // MANUALPROCESS_H
