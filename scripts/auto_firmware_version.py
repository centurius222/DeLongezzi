import os
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

# Reproducible builds (2026-10-30): the same commit gives the same program. The build time is
# SOURCE_DATE_EPOCH when set (scripts/build_release.sh sets it), else the commit's time when
# nothing tracked is changed; only a build with uncommitted changes uses the clock.
def get_build_epoch():
    if os.environ.get("SOURCE_DATE_EPOCH", "").isdigit():
        return int(os.environ["SOURCE_DATE_EPOCH"])
    try:
        changed = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        commit = subprocess.run(["git", "log", "-1", "--format=%ct"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    except OSError:  # no git on this PC
        return None
    if changed.returncode == 0 and not changed.stdout.strip() and commit.stdout.strip().isdigit():
        return int(commit.stdout.strip())
    return None

def get_time_specifier_build_flag():
    epoch = get_build_epoch()
    if epoch is None:
        when = datetime.datetime.now(datetime.timezone.utc)
    else:
        when = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc)
        # The compiler takes __DATE__ and __TIME__ from it too (HomeSpan has them).
        env["ENV"]["SOURCE_DATE_EPOCH"] = str(epoch)
    build_timestamp = when.strftime("%Y-%m-%dT%H:%M:%SZ")
    build_flag = "#define BUILD_TIMESTAMP \"" + build_timestamp + "\""
    print ("Build date: " + build_timestamp)
    return build_flag

# Reproducible: the program's checksum covers the debug info, which names the build folder and
# PlatformIO's packages folder (both differ per PC), so give them fixed names.
for folder, name in (("$PROJECT_DIR", "."), ("$PROJECT_PACKAGES_DIR", "/platformio/packages")):
    if env.subst(folder):
        env.Append(CCFLAGS=["-ffile-prefix-map=%s=%s" % (env.subst(folder), name)])

with open('src/version.h', 'w') as f:
    f.write(
        '#pragma once\n' +
        '#ifndef GIT_VERSION_H\n' +
        '#define GIT_VERSION_H\n' +
        get_firmware_specifier_build_flag() + '\n' +
        get_time_specifier_build_flag() + '\n'
        '#endif\n'
    )
