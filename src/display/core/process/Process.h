#ifndef PROCESS_H
#define PROCESS_H

constexpr double PREDICTIVE_TIME = 4000.0; // time window for the prediction
// constexpr double PREDICTIVE_TIME_MS = 1000.0;

class Process {
  public:
    Process() = default;
    virtual ~Process() = default;

    virtual bool isRelayActive() = 0;

    virtual bool isAltRelayActive() = 0;

    virtual float getPumpValue() = 0;

    virtual void progress() = 0;

    virtual bool isActive() = 0;

    virtual bool isComplete() = 0;

    virtual int getType() = 0;

    virtual void updateVolume(double volume) = 0;

    // Called once by Controller::deactivateLocked when the process stops being
    // the current one. A process cannot otherwise tell the difference between
    // "still running" and "the user pressed stop": isActive() only sees its own
    // targets, and the stop button never touches the process at all.
    virtual void end() {}
};

enum class ProcessTarget { VOLUMETRIC, TIME };
enum class ProcessPhase { RUNNING, FINISHED };

#endif // PROCESS_H
