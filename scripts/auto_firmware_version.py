import re
import subprocess
import datetime

Import("env")

def get_firmware_specifier_build_flag():
    try:
        ret = subprocess.run(["git", "describe", "--tags", "--dirty", "--exclude", "nightly", "--exclude", "db"], stdout=subprocess.PIPE, text=True) #Uses any tags
        version = ret.stdout.strip()
    except OSError:  # no git on this PC (e.g. built from a release's source zip)
        version = ""
    # The firmware parses this at every boot (GitHubOTA -> from_string) and crashes on fewer
    # than 3 numbers, so only a plain vX.Y.Z tag is used; anything else (v2.2.2-3-gabc, -dirty,
    # other tags) builds as "" (2026-10-22, build 969).
    build_version = version if re.fullmatch(r"v\d+\.\d+\.\d+", version) else ""
    build_flag = "#define BUILD_GIT_VERSION \"" + build_version + "\""
    print ("Build version: " + build_version)
    return build_flag

def get_time_specifier_build_flag():
    build_timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    build_flag = "#define BUILD_TIMESTAMP \"" + build_timestamp + "\""
    print ("Build date: " + build_timestamp)
    return build_flag

with open('src/version.h', 'w') as f:
    f.write(
        '#pragma once\n' +
        '#ifndef GIT_VERSION_H\n' +
        '#define GIT_VERSION_H\n' +
        get_firmware_specifier_build_flag() + '\n' +
        get_time_specifier_build_flag() + '\n'
        '#endif\n'
    )
