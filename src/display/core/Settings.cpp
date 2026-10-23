#include "Settings.h"

#include <algorithm>
#include <display/util/ColorConversion.h>
#include <utility>

// "HH:MM|1111111;..." (days Mon..Sun): the text form of the wake-up schedules,
// in storage and in the settings file.
static std::vector<AutoWakeupSchedule> parseSchedules(const String &schedulesStr) {
    std::vector<AutoWakeupSchedule> schedules;

    if (schedulesStr.length() > 0) {
        int start = 0;
        int end = schedulesStr.indexOf(';');

        while (end != -1 || start < schedulesStr.length()) {
            String scheduleStr = (end != -1) ? schedulesStr.substring(start, end) : schedulesStr.substring(start);

            int pipePos = scheduleStr.indexOf('|');
            if (pipePos != -1) {
                String timeStr = scheduleStr.substring(0, pipePos);
                String daysStr = scheduleStr.substring(pipePos + 1);

                AutoWakeupSchedule schedule;
                schedule.time = timeStr;

                if (daysStr.length() == 7) {
                    for (int i = 0; i < 7; i++) {
                        schedule.days[i] = (daysStr.charAt(i) == '1');
                    }
                }

                schedules.push_back(schedule);
            }

            if (end == -1)
                break;
            start = end + 1;
            end = schedulesStr.indexOf(';', start);
        }
    }
    return schedules;
}

static String serializeSchedules(const std::vector<AutoWakeupSchedule> &value) {
    String serialized = "";
    for (size_t i = 0; i < value.size(); i++) {
        if (i > 0)
            serialized += ";";
        serialized += value[i].time + "|";
        for (int j = 0; j < 7; j++) {
            serialized += value[i].days[j] ? "1" : "0";
        }
    }
    return serialized;
}

std::vector<AutoWakeupSchedule>
PreferencesCodec<std::vector<AutoWakeupSchedule>>::read(Preferences &prefs, const char *key,
                                                        const std::vector<AutoWakeupSchedule> &def) {
    std::vector<AutoWakeupSchedule> schedules = parseSchedules(prefs.getString(key, ""));
    return schedules.empty() ? def : schedules;
}

void PreferencesCodec<std::vector<AutoWakeupSchedule>>::write(Preferences &prefs, const char *key,
                                                              const std::vector<AutoWakeupSchedule> &value) {
    prefs.putString(key, serializeSchedules(value));
}

void JsonCodec<std::vector<AutoWakeupSchedule>>::write(JsonObject obj, const char *key,
                                                       const std::vector<AutoWakeupSchedule> &value) {
    obj[key] = serializeSchedules(value);
}

bool JsonCodec<std::vector<AutoWakeupSchedule>>::read(JsonVariantConst in, std::vector<AutoWakeupSchedule> &value) {
    if (!in.is<String>())
        return false;
    std::vector<AutoWakeupSchedule> schedules = parseSchedules(in.as<String>());
    if (schedules.empty())
        return false;
    value = schedules;
    return true;
}

Settings::Settings() {
    preferences.begin(PREFERENCES_KEY, true);
    for (auto *property : registry) {
        property->load(preferences);
    }

    // Legacy migrations: derive defaults for keys that were never persisted
    if (!preferences.isKey("sg_m")) {
        smartGrindMode.initDefault(smartGrindToggle.get() ? 1 : 0);
    }
    sunriseR = preferences.getInt("sr_r", 0);
    sunriseG = preferences.getInt("sr_g", 250);
    sunriseB = preferences.getInt("sr_b", 150);
    sunriseW = preferences.getInt("sr_w", 255);
    if (!preferences.isKey("sr_i")) {
        sunriseIdle.initDefault(ColorConversion::toHex(sunriseR, sunriseG, sunriseB, sunriseW));
    }
    preferences.end();

    xTaskCreate(loopTask, "Settings::loop", 3072, this, 1, &taskHandle); // used ~1.3 KB (measured peak 2026-10-09 after a shot with the scale; trimmed to free fast memory)
}

void Settings::batchUpdate(const SettingsCallback &callback) {
    // Changed properties mark themselves dirty; the next flush writes them in one NVS session
    callback(this);
}

void Settings::save(bool noDelay) {
    if (noDelay) {
        doSave();
    }
}

void Settings::exportAll(JsonObject out) const {
    for (auto *property : registry) {
        property->writeJson(out);
    }
}

int Settings::importAll(JsonObjectConst in) {
    int applied = 0;
    for (auto *property : registry) {
        // Machine state, not preferences: the shot number counter (an older file
        // would make new shots reuse numbers of existing ones) and the one-shot
        // portal switch.
        const char *key = property->storageKey();
        if (strcmp(key, "hi") == 0 || strcmp(key, "bap") == 0)
            continue;
        JsonVariantConst value = in[key];
        if (!value.isNull() && property->readJson(value))
            applied++;
    }
    doSave();
    return applied;
}

void Settings::setTargetSteamTemp(const int target_steam_temp) { targetSteamTemp.set(target_steam_temp); }

void Settings::setTargetWaterTemp(const int target_water_temp) { targetWaterTemp.set(target_water_temp); }

void Settings::setTargetManualTemp(const int target_manual_temp) { targetManualTemp.set(target_manual_temp); }

void Settings::setTargetManualWeight(const float target_manual_weight) { targetManualWeight.set(target_manual_weight); }

void Settings::setTargetManualPressure(const float target_manual_pressure) {
    targetManualPressure.set(target_manual_pressure);
}

void Settings::setBrewNumColor(const String &brew_num_color) { brewNumColor.set(brew_num_color); }

void Settings::setThemeBg(const String &theme_bg) { themeBg.set(theme_bg); }

void Settings::setThemeAccent(const String &theme_accent) { themeAccent.set(theme_accent); }

void Settings::setThemeText(const String &theme_text) { themeText.set(theme_text); }

void Settings::setWebTheme(const String &web_theme) { webTheme.set(web_theme); }

void Settings::setHolidayMode(const String &holiday_mode) { holidayMode.set(holiday_mode); }

void Settings::setBrewVideo(const String &id) { brewVideo.set(id); }

void Settings::setBrewVideoMode(const String &mode) { brewVideoMode.set(mode); }
void Settings::setKeepTheme(bool keep) { keepTheme.set(keep); }

void Settings::setBrewNumOpacity(const int brew_num_opacity) { brewNumOpacity.set(brew_num_opacity); }

void Settings::setBrewNumSize(const int brew_num_size) { brewNumSize.set(brew_num_size); }

void Settings::setChartTimer(const int chart_timer) { chartTimer.set(chart_timer); }

void Settings::setChartTimerOpacity(const int chart_timer_opacity) { chartTimerOpacity.set(chart_timer_opacity); }

void Settings::setChartTimerSize(const int chart_timer_size) { chartTimerSize.set(chart_timer_size); }

void Settings::setShotHistoryLimit(const int limit) { shotHistoryLimit.set(limit); }

void Settings::setSaveManualShots(bool save) { saveManualShots.set(save); }

void Settings::setHeatUpCheck(bool on) { heatUpCheck.set(on); }

void Settings::setBtStandby(bool on) { btStandby.set(on); }

void Settings::setLastGrinder(const String &grinder) { lastGrinder.set(grinder); }

void Settings::setLastBasket(const String &basket) { lastBasket.set(basket); }

void Settings::setTemperatureOffset(const int temperature_offset) { temperatureOffset.set(temperature_offset); }

void Settings::setPressureScaling(const float pressure_scaling) { pressureScaling.set(pressure_scaling); }

void Settings::setTargetGrindVolume(double target_grind_volume) { targetGrindVolume.set(target_grind_volume); }

void Settings::setTargetGrindDuration(const int target_duration) { targetGrindDuration.set(target_duration); }

void Settings::setBrewDelay(double brew_Delay) { brewDelay.set(std::clamp(brew_Delay, 0.0, 4000.0)); }

void Settings::setGrindDelay(double grind_Delay) { grindDelay.set(std::clamp(grind_Delay, 0.0, 4000.0)); }

void Settings::setDelayAdjust(bool delay_adjust) { delayAdjust.set(delay_adjust); }

void Settings::setStartupMode(const int startup_mode) { startupMode.set(startup_mode); }

void Settings::setStandbyTimeout(int standby_timeout) { standbyTimeout.set(standby_timeout); }

void Settings::setPid(const String &pid) { this->pid.set(pid); }

void Settings::setPumpModelCoeffs(const String &pumpModelCoeffs) { this->pumpModelCoeffs.set(pumpModelCoeffs); }

void Settings::setPumpSlipCoeffs(const String &pumpSlipCoeffs) { this->pumpSlipCoeffs.set(pumpSlipCoeffs); }

// Stored trimmed (every save path comes through here: the Settings page, the hotspot page).
void Settings::setWifiSsid(const String &wifiSsid) {
    String s = wifiSsid;
    s.trim();
    this->wifiSsid.set(s);
}

void Settings::setWifiPassword(const String &wifiPassword) {
    String s = wifiPassword;
    s.trim();
    this->wifiPassword.set(s);
}

void Settings::setWifiApPassword(const String &wifiApPassword) { this->wifiApPassword.set(wifiApPassword); }

void Settings::setMdnsName(const String &mdnsName) { this->mdnsName.set(mdnsName); }

void Settings::setLastIp(const String &ip) { lastIp.set(ip); }

void Settings::setHomekit(const bool homekit) { this->homekit.set(homekit); }

void Settings::setVolumetricTarget(bool volumetric_target) { volumetricTarget.set(volumetric_target); }

void Settings::setOTAChannel(const String &otaChannel) { this->otaChannel.set(otaChannel); }

void Settings::setSavedScale(const String &savedScale) { this->savedScale.set(savedScale); }

void Settings::setBoilerFillActive(bool boiler_fill_active) { boilerFillActive.set(boiler_fill_active); }

void Settings::setStartupFillTime(int startup_fill_time) { startupFillTime.set(startup_fill_time); }

void Settings::setSteamFillTime(int steam_fill_time) { steamFillTime.set(steam_fill_time); }

void Settings::setSmartGrindActive(bool smart_grind_active) { smartGrindActive.set(smart_grind_active); }

void Settings::setSmartGrindIp(String smart_grind_ip) { smartGrindIp.set(smart_grind_ip); }

void Settings::setSmartGrindMode(int smart_grind_mode) { smartGrindMode.set(smart_grind_mode); }

void Settings::setHomeAssistant(const bool homeAssistant) { this->homeAssistant.set(homeAssistant); }

void Settings::setHomeAssistantIP(const String &homeAssistantIP) { this->homeAssistantIP.set(homeAssistantIP); }

void Settings::setHomeAssistantPort(const int homeAssistantPort) { this->homeAssistantPort.set(homeAssistantPort); }

void Settings::setHomeAssistantTopic(const String &homeAssistantTopic) { this->homeAssistantTopic.set(homeAssistantTopic); }

void Settings::setHomeAssistantUser(const String &homeAssistantUser) { this->homeAssistantUser.set(homeAssistantUser); }

void Settings::setHomeAssistantPassword(const String &homeAssistantPassword) {
    this->homeAssistantPassword.set(homeAssistantPassword);
}

void Settings::setMomentaryButtons(bool momentary_buttons) { momentaryButtons.set(momentary_buttons); }

void Settings::setTimezone(String timezone) { this->timezone.set(timezone); }

void Settings::setClockFormat(bool clock_24h_format) { clock24hFormat.set(clock_24h_format); }

void Settings::setSelectedProfile(String selected_profile) { selectedProfile.set(selected_profile); }

void Settings::setStartupProfile(String startup_profile) { startupProfile.set(startup_profile); }

void Settings::setFavoritedProfiles(std::vector<String> favorited_profiles) { favoritedProfiles.set(favorited_profiles); }

void Settings::addFavoritedProfile(String profile) {
    std::vector<String> profiles = favoritedProfiles.get();
    if (std::find(profiles.begin(), profiles.end(), profile) != profiles.end()) {
        return;
    }
    profiles.emplace_back(std::move(profile));
    favoritedProfiles.set(profiles);
}

void Settings::removeFavoritedProfile(String profile) {
    std::vector<String> profiles = favoritedProfiles.get();
    profiles.erase(std::remove(profiles.begin(), profiles.end(), profile), profiles.end());
    favoritedProfiles.set(profiles);
}

void Settings::setProfileOrder(std::vector<String> profile_order) {
    std::vector<String> cleaned;
    cleaned.reserve(profile_order.size());
    for (auto &id : profile_order) {
        if (id.isEmpty())
            continue;
        if (std::find(cleaned.begin(), cleaned.end(), id) == cleaned.end()) {
            cleaned.emplace_back(std::move(id));
        }
    }

    profileOrder.set(cleaned);
}

void Settings::setMainBrightness(int main_brightness) { mainBrightness.set(main_brightness); }

void Settings::setStandbyBrightness(int standby_brightness) { standbyBrightness.set(standby_brightness); }

void Settings::setStandbyBrightnessTimeout(int standby_brightness_timeout) {
    standbyBrightnessTimeout.set(standby_brightness_timeout);
}

void Settings::setWifiApTimeout(int timeout) { wifiApTimeout.set(timeout); }

void Settings::setSteamPumpPercentage(float steam_pump_percentage) { steamPumpPercentage.set(steam_pump_percentage); }

void Settings::setSteamPumpCutoff(float steam_pump_cutoff) { steamPumpCutoff.set(steam_pump_cutoff); }

void Settings::setThemeMode(int theme_mode) { themeMode.set(theme_mode); }

void Settings::setHistoryIndex(int history_index) { historyIndex.set(history_index); }

void Settings::setSunriseR(int sunrise_r) { sunriseR = sunrise_r; }

void Settings::setSunriseG(int sunrise_g) { sunriseG = sunrise_g; }

void Settings::setSunriseB(int sunrise_b) { sunriseB = sunrise_b; }

void Settings::setSunriseW(int sunrise_w) { sunriseW = sunrise_w; }

void Settings::setSunriseIdle(String hexColor) { sunriseIdle.set(hexColor); }

void Settings::setSunriseActive(String hexColor) { sunriseActive.set(hexColor); }

void Settings::setSunriseFinished(String hexColor) { sunriseFinished.set(hexColor); }

void Settings::setSunriseError(String hexColor) { sunriseError.set(hexColor); }

void Settings::setSunriseExtBrightness(int sunrise_ext_brightness) { sunriseExtBrightness.set(sunrise_ext_brightness); }

void Settings::setEmptyTankDistance(int empty_tank_distance) { emptyTankDistance.set(empty_tank_distance); }

void Settings::setFullTankDistance(int full_tank_distance) { fullTankDistance.set(full_tank_distance); }

void Settings::setAltRelayFunction(int alt_relay_function) { altRelayFunction.set(alt_relay_function); }

void Settings::setAutoWakeupEnabled(bool enabled) { autowakeupEnabled.set(enabled); }

void Settings::setAutoWakeupSchedules(const std::vector<AutoWakeupSchedule> &schedules) { autowakeupSchedules.set(schedules); }

void Settings::setButtonBehavior(int index, String behavior) {
    std::vector<String> behaviors = buttonBehavior.get();
    if (index < 0 || index >= behaviors.size()) {
        return;
    }
    behaviors[index] = std::move(behavior);
    buttonBehavior.set(behaviors);
}

void Settings::setButtonBehaviorList(const std::vector<String> &behavior_list) { buttonBehavior.set(behavior_list); }

void Settings::setCommutationGain(float commutation_gain) { commutationGain.set(commutation_gain); }

void Settings::setConvergenceGain(float convergence_gain) { convergenceGain.set(convergence_gain); }

void Settings::setIntegralGain(float integral_gain) { integralGain.set(integral_gain); }

void Settings::setMaxPumpPower(float max_pump_power) { maxPumpPower.set(max_pump_power); }

void Settings::doSave() {
    // One writer at a time (2026-10-19, review 1.2): the 5 s flush (loopTask) and a page's Save
    // (save(true) on the web server task) could both run here on the one Preferences handle; the
    // second begin() failed, its writes went nowhere, and that change was gone after a restart.
    std::lock_guard<std::mutex> lock(saveMutex);
    bool dirty = false;
    for (auto *property : registry) {
        if (property->isDirty()) {
            dirty = true;
            break;
        }
    }
    if (!dirty) {
        return;
    }
    ESP_LOGI("Settings", "Saving changed settings");
    if (!preferences.begin(PREFERENCES_KEY, false)) {
        // nothing written: the changed values stay marked and the next pass saves them
        ESP_LOGE("Settings", "Settings store could not be opened, saving on the next pass");
        return;
    }
    for (auto *property : registry) {
        property->store(preferences);
    }
    preferences.end();
}

[[noreturn]] void Settings::loopTask(void *arg) {
    auto *settings = static_cast<Settings *>(arg);
    while (true) {
        settings->doSave();
        vTaskDelay(5000 / portTICK_PERIOD_MS);
    }
}
