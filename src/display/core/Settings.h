#pragma once
#ifndef SETTINGS_H
#define SETTINGS_H

#include <Arduino.h>
#include <Preferences.h>
#include <display/core/Property.h>
#include <display/core/constants.h>
#include <display/core/utils.h>
#include <mutex>
#include <vector>

#define PREFERENCES_KEY "controller"

struct AutoWakeupSchedule {
    String time;    // HH:MM format
    bool days[7]{}; // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]

    AutoWakeupSchedule() : time("07:00") {
        // Default to all days enabled
        for (int i = 0; i < 7; i++) {
            days[i] = true;
        }
    }

    explicit AutoWakeupSchedule(const String &timeStr) : time(timeStr) {
        // Default to all days enabled
        for (int i = 0; i < 7; i++) {
            days[i] = true;
        }
    }

    [[nodiscard]] bool isDayEnabled(const int dayOfWeek) const {
        // dayOfWeek: 1=Monday, 2=Tuesday, ..., 7=Sunday
        if (dayOfWeek < 1 || dayOfWeek > 7)
            return false;
        return days[dayOfWeek - 1];
    }

    void setDayEnabled(const int dayOfWeek, const bool enabled) {
        // dayOfWeek: 1=Monday, 2=Tuesday, ..., 7=Sunday
        if (dayOfWeek >= 1 && dayOfWeek <= 7) {
            days[dayOfWeek - 1] = enabled;
        }
    }

    bool operator==(const AutoWakeupSchedule &other) const {
        if (time != other.time)
            return false;
        for (int i = 0; i < 7; i++) {
            if (days[i] != other.days[i])
                return false;
        }
        return true;
    }
};

// Serialized as "time1|days1;time2|days2" where days is a 7-bit string (e.g. "1111100" for weekdays)
template <> struct PreferencesCodec<std::vector<AutoWakeupSchedule>> {
    static std::vector<AutoWakeupSchedule> read(Preferences &prefs, const char *key, const std::vector<AutoWakeupSchedule> &def);
    static void write(Preferences &prefs, const char *key, const std::vector<AutoWakeupSchedule> &value);
};

// Settings file form: the same "HH:MM|1111111;..." text as in storage.
template <> struct JsonCodec<std::vector<AutoWakeupSchedule>> {
    static void write(JsonObject obj, const char *key, const std::vector<AutoWakeupSchedule> &value);
    static bool read(JsonVariantConst in, std::vector<AutoWakeupSchedule> &value);
};

class Settings;
using SettingsCallback = std::function<void(Settings *)>;

class Settings {
  public:
    Settings();
    // Never copied: a copy shares the Preferences NVS handle and closes it when destroyed,
    // which silently cut off a save in progress (audit S6-M1).
    Settings(const Settings &) = delete;
    Settings &operator=(const Settings &) = delete;

    void batchUpdate(const SettingsCallback &callback);
    void save(bool noDelay = false);
    // Settings file (Settings > Export/Import): every setting by its storage
    // key, defaults included. Import applies the keys present and saves; it
    // returns how many were applied.
    void exportAll(JsonObject out) const;
    int importAll(JsonObjectConst in);

    // Getters and setters
    int getTargetSteamTemp() const { return targetSteamTemp.get(); }
    int getTargetWaterTemp() const { return targetWaterTemp.get(); }
    int getTargetManualTemp() const { return targetManualTemp.get(); }
    float getTargetManualWeight() const { return targetManualWeight.get(); }
    float getTargetManualPressure() const { return targetManualPressure.get(); }
    String getBrewNumColor() const { return brewNumColor.get(); }
    String getThemeBg() const { return themeBg.get(); }
    String getThemeAccent() const { return themeAccent.get(); }
    String getThemeText() const { return themeText.get(); }
    String getWebTheme() const { return webTheme.get(); }
    String getHolidayMode() const { return holidayMode.get(); }
    // Brew button video library (Settings > Pictures): the video in use (an id in /vid, "" = none)
    // and how videos are picked: "fixed" (that one) or "shuffle" (another each shot).
    String getBrewVideo() const { return brewVideo.get(); }
    String getBrewVideoMode() const { return brewVideoMode.get(); }
    bool isKeepTheme() const { return keepTheme.get(); }
    int getBrewNumOpacity() const { return brewNumOpacity.get(); }
    int getBrewNumSize() const { return brewNumSize.get(); }
    int getChartTimer() const { return chartTimer.get(); }
    int getChartTimerOpacity() const { return chartTimerOpacity.get(); }
    int getChartTimerSize() const { return chartTimerSize.get(); }
    // Shots kept in the history: 50 or 100, 0 = all (until the storage is nearly full).
    int getShotHistoryLimit() const { return shotHistoryLimit.get(); }
    // Manual-mode runs saved to Shot History too (off by default).
    bool isSaveManualShots() const { return saveManualShots.get(); }
    // Heater shuts down when full power doesn't raise the reading (on by default).
    bool isHeatUpCheck() const { return heatUpCheck.get(); }
    // Settings > Bluetooth "Bluetooth standby between shots" (off by default, 2026-10-19).
    bool isBtStandby() const { return btStandby.get(); }
    // Shot Notes' grinder dropdown opens on this one ("Brand|Model"), on every device.
    String getLastGrinder() const { return lastGrinder.get(); }
    // Shot Notes' basket pop-up opens on this one ("Brand|mm|g|pressurized").
    String getLastBasket() const { return lastBasket.get(); }
    int getTemperatureOffset() const { return temperatureOffset.get(); }
    float getPressureScaling() const { return pressureScaling.get(); }
    int getPressureSensorMode() const { return pressureSensorMode.get(); }
    void setPressureSensorMode(int m) { pressureSensorMode.set(m); }
    int getWaterLevelEmpty() const { return waterLevelEmpty.get(); }
    void setWaterLevelEmpty(int v) { waterLevelEmpty.set(v); }
    int getWaterLevelFull() const { return waterLevelFull.get(); }
    void setWaterLevelFull(int v) { waterLevelFull.set(v); }
    double getTargetGrindVolume() const { return targetGrindVolume.get(); }
    int getTargetGrindDuration() const { return targetGrindDuration.get(); }
    int getStartupMode() const { return startupMode.get(); }
    int getStandbyTimeout() const { return standbyTimeout.get(); }
    double getBrewDelay() const { return brewDelay.get(); }
    double getGrindDelay() const { return grindDelay.get(); }
    bool isDelayAdjust() const { return delayAdjust.get(); }
    String getPid() const { return pid.get(); }
    String getPumpModelCoeffs() const { return pumpModelCoeffs.get(); }
    String getPumpSlipCoeffs() const { return pumpSlipCoeffs.get(); }
    // Leading/trailing spaces are never part of the Wi-Fi details (a phone keyboard suggestion
    // added one; 2026-10-14): trimmed here for every reader, also values saved before the fix.
    String getWifiSsid() const {
        String s = wifiSsid.get();
        s.trim();
        return s;
    }
    String getWifiPassword() const {
        String s = wifiPassword.get();
        s.trim();
        return s;
    }
    String getWifiApPassword() const { return wifiApPassword.get(); }
    String getMdnsName() const { return mdnsName.get(); }
    // The address the router gave the machine last time (shown on the hotspot page).
    String getLastIp() const { return lastIp.get(); }
    bool getBootIntoAp() const { return bootIntoAp.get(); }
    void setBootIntoAp(bool v) { bootIntoAp.set(v); }
    bool isHomekit() const { return homekit.get(); }
    bool isVolumetricTarget() const { return volumetricTarget.get(); }
    String getOTAChannel() const { return otaChannel.get(); }
    String getSavedScale() const { return savedScale.get(); }
    bool isBoilerFillActive() const { return boilerFillActive.get(); }
    int getStartupFillTime() const { return startupFillTime.get(); }
    int getSteamFillTime() const { return steamFillTime.get(); }
    bool isSmartGrindActive() const { return smartGrindActive.get(); }
    int getSmartGrindMode() const { return smartGrindMode.get(); }
    String getSmartGrindIp() const { return smartGrindIp.get(); }
    bool isHomeAssistant() const { return homeAssistant.get(); }
    String getHomeAssistantIP() const { return homeAssistantIP.get(); }
    String getHomeAssistantUser() const { return homeAssistantUser.get(); }
    String getHomeAssistantPassword() const { return homeAssistantPassword.get(); }
    int getHomeAssistantPort() const { return homeAssistantPort.get(); }
    String getHomeAssistantTopic() const { return homeAssistantTopic.get(); }
    bool isMomentaryButtons() const { return momentaryButtons.get(); }
    String getTimezone() const { return timezone.get(); }
    bool isClock24hFormat() const { return clock24hFormat.get(); }
    String getSelectedProfile() const { return selectedProfile.get(); }
    String getStartupProfile() const { return startupProfile.get(); }
    const std::vector<String> &getFavoritedProfiles() const { return favoritedProfiles.get(); }
    std::vector<String> getProfileOrder() const { return profileOrder.get(); }
    int getMainBrightness() const { return mainBrightness.get(); }
    int getStandbyBrightness() const { return standbyBrightness.get(); }
    int getStandbyBrightnessTimeout() const { return standbyBrightnessTimeout.get(); }
    int getWifiApTimeout() const { return wifiApTimeout.get(); }
    float getSteamPumpPercentage() const { return steamPumpPercentage.get(); }
    float getSteamPumpCutoff() const { return steamPumpCutoff.get(); }
    int getThemeMode() const { return themeMode.get(); }
    int getHistoryIndex() const { return historyIndex.get(); }

    [[deprecated]]
    int getSunriseR() const {
        return sunriseR;
    }
    [[deprecated]]
    int getSunriseG() const {
        return sunriseG;
    }
    [[deprecated]]
    int getSunriseB() const {
        return sunriseB;
    }
    [[deprecated]]
    int getSunriseW() const {
        return sunriseW;
    }
    String getSunriseIdle() const { return sunriseIdle.get(); }
    String getSunriseActive() const { return sunriseActive.get(); }
    String getSunriseFinished() const { return sunriseFinished.get(); }
    String getSunriseError() const { return sunriseError.get(); }
    int getSunriseExtBrightness() const { return sunriseExtBrightness.get(); }
    int getEmptyTankDistance() const { return emptyTankDistance.get(); }
    int getFullTankDistance() const { return fullTankDistance.get(); }
    int getAltRelayFunction() const { return altRelayFunction.get(); }
    bool isAutoWakeupEnabled() const { return autowakeupEnabled.get(); }
    std::vector<AutoWakeupSchedule> getAutoWakeupSchedules() const { return autowakeupSchedules.get(); }
    String getButtonBehavior(int index) const {
        if (index >= 0 && index < buttonBehavior.get().size())
            return buttonBehavior.get()[index];
        return "";
    };
    std::vector<String> getButtonBehaviorList() const { return buttonBehavior.get(); }
    float getCommutationGain() const { return commutationGain.get(); }
    float getConvergenceGain() const { return convergenceGain.get(); }
    float getIntegralGain() const { return integralGain.get(); }
    float getMaxPumpPower() const { return maxPumpPower.get(); }

    void setTargetSteamTemp(int target_steam_temp);
    void setTargetWaterTemp(int target_water_temp);
    void setTargetManualTemp(int target_manual_temp);
    void setTargetManualWeight(float target_manual_weight);
    void setTargetManualPressure(float target_manual_pressure);
    void setBrewNumColor(const String &brew_num_color);
    void setThemeBg(const String &theme_bg);
    void setThemeAccent(const String &theme_accent);
    void setThemeText(const String &theme_text);
    void setWebTheme(const String &web_theme);
    void setHolidayMode(const String &holiday_mode);
    void setBrewVideo(const String &id);
    void setBrewVideoMode(const String &mode);
    void setKeepTheme(bool keep);
    void setBrewNumOpacity(int brew_num_opacity);
    void setBrewNumSize(int brew_num_size);
    void setChartTimer(int chart_timer);
    void setChartTimerOpacity(int chart_timer_opacity);
    void setChartTimerSize(int chart_timer_size);
    void setShotHistoryLimit(int limit);
    void setTemperatureOffset(int temperature_offset);
    void setPressureScaling(float pressure_scaling);
    void setTargetGrindVolume(double target_grind_volume);
    void setTargetGrindDuration(int target_duration);
    void setStartupMode(int startup_mode);
    void setStandbyTimeout(int standby_timeout);
    void setBrewDelay(double brewDelay);
    void setGrindDelay(double grindDelay);
    void setDelayAdjust(bool delay_adjust);
    void setPid(const String &pid);
    void setPumpModelCoeffs(const String &pumpModelCoeffs);
    void setPumpSlipCoeffs(const String &pumpSlipCoeffs);
    void setWifiSsid(const String &wifiSsid);
    void setWifiPassword(const String &wifiPassword);
    void setWifiApPassword(const String &wifiApPassword);
    void setMdnsName(const String &mdnsName);
    void setLastIp(const String &ip);
    void setHomekit(bool homekit);
    void setVolumetricTarget(bool volumetric_target);
    void setOTAChannel(const String &otaChannel);
    void setSavedScale(const String &savedScale);
    void setBoilerFillActive(bool boiler_fill_active);
    void setStartupFillTime(int startup_fill_time);
    void setSteamFillTime(int steam_fill_time);
    void setSmartGrindActive(bool smart_grind_active);
    void setSmartGrindIp(String smart_grind_ip);
    void setSmartGrindMode(int smart_grind_mode);
    void setHomeAssistant(bool homeAssistant);
    void setHomeAssistantUser(const String &homeAssistantUser);
    void setHomeAssistantPassword(const String &homeAssistantPassword);
    void setHomeAssistantIP(const String &homeAssistantIP);
    void setHomeAssistantPort(int homeAssistantPort);
    void setHomeAssistantTopic(const String &homeAssistantTopic);
    void setMomentaryButtons(bool momentary_buttons);
    void setSaveManualShots(bool save);
    void setHeatUpCheck(bool on);
    void setBtStandby(bool on);
    void setLastGrinder(const String &grinder);
    void setLastBasket(const String &basket);
    void setTimezone(String timezone);
    void setClockFormat(bool format_24h);
    void setSelectedProfile(String selected_profile);
    void setStartupProfile(String startup_profile);
    void setFavoritedProfiles(std::vector<String> favorited_profiles);
    void addFavoritedProfile(String profile);
    void removeFavoritedProfile(String profile);
    void setProfileOrder(std::vector<String> profile_order);
    void setMainBrightness(int main_brightness);
    void setStandbyBrightness(int standby_brightness);
    void setStandbyBrightnessTimeout(int standby_brightness_timeout);
    void setWifiApTimeout(int timeout);
    void setSteamPumpPercentage(float steam_pump_percentage);
    void setSteamPumpCutoff(float steam_pump_cutoff);
    void setThemeMode(int theme_mode);
    void setHistoryIndex(int history_index);
    [[deprecated]]
    void setSunriseR(int sunrise_r);
    [[deprecated]]
    void setSunriseG(int sunrise_g);
    [[deprecated]]
    void setSunriseB(int sunrise_b);
    [[deprecated]]
    void setSunriseW(int sunrise_w);
    void setSunriseIdle(String hexColor);
    void setSunriseActive(String hexColor);
    void setSunriseFinished(String hexColor);
    void setSunriseError(String hexColor);
    void setSunriseExtBrightness(int sunrise_ext_brightness);
    void setEmptyTankDistance(int empty_tank_distance);
    void setFullTankDistance(int full_tank_distance);
    void setAltRelayFunction(int alt_relay_function);
    void setAutoWakeupEnabled(bool enabled);
    void setAutoWakeupSchedules(const std::vector<AutoWakeupSchedule> &schedules);
    void setButtonBehavior(int index, String behavior);
    void setButtonBehaviorList(const std::vector<String> &behavior_list);

    void setCommutationGain(float commutationGain);
    void setConvergenceGain(float convergenceGain);
    void setIntegralGain(float integralGain);
    void setMaxPumpPower(float maxPumpPower);

  private:
    Preferences preferences;
    std::mutex saveMutex; // one writer at a time: the 5 s flush and a page's Save (doSave)
    PropertyRegistry registry; // must precede the properties, they register themselves here

    Property<String> selectedProfile{registry, "sp", ""};
    Property<String> startupProfile{registry, "sup", ""}; // Empty = last used profile, otherwise profile ID
    Property<int> targetSteamTemp{registry, "ts", 145};
    Property<int> targetWaterTemp{registry, "tw", 80};
    // Manual mode keeps its own temperature rather than borrowing the selected
    // profile's, so switching profiles never moves the manual target.
    Property<int> targetManualTemp{registry, "tm", DEFAULT_TARGET_MANUAL_TEMP};
    // Stop-at-weight for manual mode. 0 = off. Persisted like every other
    // target: it used to be a runtime-only field on Controller, so a reboot
    // silently disarmed it and the next shot ran to the safety backstop.
    Property<float> targetManualWeight{registry, "mwt", 0.0f};
    // Manual mode pressure, remembered across reboots the same way (user
    // 2026-09-24); DEFAULT_MANUAL_PRESSURE only until it is first changed.
    // The slider can send many values, but the 5 s batch flush writes NVS once.
    Property<float> targetManualPressure{registry, "mpr", DEFAULT_MANUAL_PRESSURE};
    // Seconds on the brew button while custom art is shown (user 2026-09-24):
    // colour "#rrggbb" and opacity 0-100. The default button ignores them.
    Property<String> brewNumColor{registry, "bnc", "#ffffff"};
    Property<int> brewNumOpacity{registry, "bno", 60};
    Property<int> brewNumSize{registry, "bns", 100}; // percent, 50-160 (opacity 0 hides them)
    // The shot timer, big, in the middle of the chart too (user 2026-09-30): on (1) / off (0),
    // its opacity 0-100 and size in percent 40-200.
    Property<int> chartTimer{registry, "ctn", 0};
    Property<int> chartTimerOpacity{registry, "cto", 35};
    Property<int> chartTimerSize{registry, "cts", 100};
    Property<int> shotHistoryLimit{registry, "shl", 50};
    Property<bool> saveManualShots{registry, "sms", false};
    Property<bool> heatUpCheck{registry, "huc", true};
    Property<bool> btStandby{registry, "btsb", false};
    Property<String> lastGrinder{registry, "lgr", ""};
    Property<String> lastBasket{registry, "lbk", ""};
    // Custom web theme (Settings > Theme > Custom), "#rrggbb" used exactly as
    // picked. Defaults match the Dark theme: page, accent, text.
    Property<String> themeBg{registry, "tbg", "#0a1120"};
    Property<String> themeAccent{registry, "tac", "#3abdf7"};
    Property<String> themeText{registry, "ttx", "#c9cbd0"};
    // Web theme every device follows (system, light, dark, coffee, nord, custom);
    // empty = not chosen yet, each browser keeps its own.
    Property<String> webTheme{registry, "wth", ""};
    // Holiday decorations on the web page: "auto" (on their dates), "off", or one
    // holiday kept on (e.g. "christmas"); the page knows the dates and pictures.
    Property<String> holidayMode{registry, "hol", "auto"};
    Property<String> brewVideo{registry, "bvi", ""};
    Property<String> brewVideoMode{registry, "bvm", "fixed"};
    // "Don't change theme on holidays": the picked theme stays even on a dated theme's day
    Property<bool> keepTheme{registry, "hkeep", false};
    Property<int> temperatureOffset{registry, "to", DEFAULT_TEMPERATURE_OFFSET};
    Property<float> pressureScaling{registry, "ps", DEFAULT_PRESSURE_SCALING};
    Property<int> pressureSensorMode{registry, "psm2", 0};
    Property<int> waterLevelEmpty{registry, "wle", 0};
    Property<int> waterLevelFull{registry, "wlf", 0};
    Property<double> targetGrindVolume{registry, "tgv", 18.0};
    Property<int> targetGrindDuration{registry, "tgd", 25000};
    Property<double> brewDelay{registry, "del_br", 800.0};
    Property<double> grindDelay{registry, "del_gd", 1000.0};
    Property<bool> delayAdjust{registry, "del_ad", true};
    Property<int> startupMode{registry, "sm", MODE_STANDBY};
    Property<bool> autowakeupEnabled{registry, "ab_en", false};
    Property<std::vector<AutoWakeupSchedule>> autowakeupSchedules{registry, "ab_schedules", {AutoWakeupSchedule("07:00")}};
    Property<int> standbyTimeout{registry, "sbt", DEFAULT_STANDBY_TIMEOUT_MS};
    Property<String> pid{registry, "pid", DEFAULT_PID};
    Property<String> wifiSsid{registry, "ws", ""};
    Property<String> wifiPassword{registry, "wp", ""};
    Property<String> wifiApPassword{registry, "wap", ""}; // empty until generated on first start
    Property<bool> bootIntoAp{registry, "bap", false};    // one-shot: force AP/portal on next boot
    Property<String> mdnsName{registry, "mn", DEFAULT_MDNS_NAME};
    Property<String> lastIp{registry, "lip", ""};
    Property<String> savedScale{registry, "ssc", ""};
    Property<bool> homekit{registry, "hk", false};
    Property<bool> volumetricTarget{registry, "vt", false};
    Property<bool> boilerFillActive{registry, "bf_a", false};
    Property<int> startupFillTime{registry, "bf_su", 5000};
    Property<int> steamFillTime{registry, "bf_st", 5000};
    Property<bool> smartGrindActive{registry, "sg_a", false};
    Property<bool> smartGrindToggle{registry, "sg_t", false}; // legacy, seeds the smartGrindMode default
    Property<int> smartGrindMode{registry, "sg_m", 0};
    Property<String> smartGrindIp{registry, "sg_i", ""};
    Property<bool> homeAssistant{registry, "ha_a", false};
    Property<String> homeAssistantUser{registry, "ha_u", ""};
    Property<String> homeAssistantPassword{registry, "ha_pw", ""};
    Property<String> homeAssistantIP{registry, "ha_i", ""};
    Property<int> homeAssistantPort{registry, "ha_p", 1883};
    Property<String> homeAssistantTopic{registry, "ha_t", DEFAULT_HOME_ASSISTANT_TOPIC};
    Property<bool> momentaryButtons{registry, "mb", false};
    Property<String> timezone{registry, "tz", DEFAULT_TIMEZONE};
    Property<bool> clock24hFormat{registry, "clk_24h", true};
    Property<String> otaChannel{registry, "oc", DEFAULT_OTA_CHANNEL};
    Property<std::vector<String>> favoritedProfiles{registry, "fp", {}};
    Property<std::vector<String>> profileOrder{registry, "po", {}}; // persisted profile ordering
    Property<float> steamPumpPercentage{registry, "spp", DEFAULT_STEAM_PUMP_PERCENTAGE};
    Property<float> steamPumpCutoff{registry, "spc", DEFAULT_STEAM_PUMP_CUTOFF};
    Property<int> historyIndex{registry, "hi", 0};

    // Display settings
    Property<int> mainBrightness{registry, "main_b", 16};
    Property<int> standbyBrightness{registry, "standby_b", 8};
    Property<int> standbyBrightnessTimeout{registry, "standby_bt", 60000}; // 60 seconds default
    Property<int> wifiApTimeout{registry, "wifi_apt", DEFAULT_WIFI_AP_TIMEOUT_MS};
    Property<int> themeMode{registry, "theme", 0};

    // Sunrise settings (r/g/b/w are legacy load-only values that seed the idle color default)
    int sunriseR = 0;
    int sunriseG = 250;
    int sunriseB = 150;
    int sunriseW = 255;
    Property<String> sunriseIdle{registry, "sr_i", "#00FFFF"};
    Property<String> sunriseActive{registry, "sr_a", "#0000FF"};
    Property<String> sunriseFinished{registry, "sr_f", "#00FF00"};
    Property<String> sunriseError{registry, "sr_e", "#FF0000"};
    Property<int> sunriseExtBrightness{registry, "sr_exb", 75};
    Property<int> emptyTankDistance{registry, "sr_ed", 210};
    Property<int> fullTankDistance{registry, "sr_fd", 30};

    Property<int> altRelayFunction{registry, "alt_relay", ALT_RELAY_GRIND}; // Default to grind
    Property<std::vector<String>> buttonBehavior{registry, "btnb", {"brew", "steam", "water"}};

    // Pump settings
    Property<String> pumpModelCoeffs{registry, "pmc", DEFAULT_PUMP_MODEL_COEFFS};
    Property<String> pumpSlipCoeffs{registry, "psc", DEFAULT_PUMP_SLIP_COEFFS};
    Property<float> commutationGain{registry, "p_cm", DEFAULT_COMMUTATION_GAIN};
    Property<float> convergenceGain{registry, "p_cv", DEFAULT_CONVERGENCE_GAIN};
    Property<float> integralGain{registry, "p_ig", DEFAULT_INTEGRAL_GAIN};
    Property<float> maxPumpPower{registry, "p_mp", 1.0f};

    void doSave();
    xTaskHandle taskHandle;
    [[noreturn]] static void loopTask(void *arg);
};

#endif // SETTINGS_H
