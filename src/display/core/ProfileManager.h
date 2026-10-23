#pragma once
#ifndef PROFILEMANAGER_H
#define PROFILEMANAGER_H
#include "PluginManager.h"
#include <FS.h>
#include <atomic>
#include <mutex>
#include <display/core/Settings.h>
#include <display/core/utils.h>
#include <display/models/profile.h>

class ProfileManager {
  public:
    ProfileManager(fs::FS *fs, String dir, Settings &settings, PluginManager *plugin_manager);

    void setup();
    std::vector<String> listProfiles();
    bool loadProfile(const String &uuid, Profile &outProfile);
    bool saveProfile(Profile &profile);
    bool deleteProfile(const String &uuid);
    bool profileExists(const String &uuid);
    void selectProfile(const String &uuid);
    Profile &getSelectedProfile();
    bool loadSelectedProfile(Profile &outProfile);
    std::vector<String> getFavoritedProfiles(bool validate = false);

    void addFavoritedProfile(String id);
    void removeFavoritedProfile(String id);

  private:
    // The selected profile, double-buffered: a reload (save/select, on the web task)
    // fills the spare copy and then switches to it, so the main loop, which reads
    // getSelectedProfile() by reference twice a second and at every shot start, never
    // sees one half rebuilt. Reloads are seconds apart, readers hold it for microseconds.
    Profile selectedProfiles[2]{};
    std::atomic<int> selectedIndex{0};
    std::recursive_mutex reloadMutex;
    bool reloadSelected(); // false: the file didn't load and the current copy stays
    PluginManager *_plugin_manager;
    Settings &_settings;
    fs::FS *_fs;
    String _dir;
    bool ensureDirectory() const;
    String profilePath(const String &uuid) const;
    void migrate(const std::vector<String> &existingProfiles);
};

#endif // PROFILEMANAGER_H
