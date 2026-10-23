import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { ApiServiceContext, machine } from '../../../services/ApiService.js';
import { downloadJson } from '../../../utils/download.js';
import { SystemTabSkeleton } from '../../../components/skeletons/SettingsSkeletons.jsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
import { Spinner } from '../../../components/Spinner.jsx';
import Section from '../../../components/Card.jsx';

const imageUrlToBase64 = async blob => {
  return new Promise((onSuccess, onError) => {
    try {
      const reader = new FileReader();
      reader.onload = function () {
        onSuccess(this.result);
      };
      reader.onerror = function () {
        onError(new Error('FileReader failed to read image blob.'));
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  });
};

const getRssiStatusClass = rssi => {
  if (rssi < -90) return 'status-error';
  if (rssi < -80) return 'status-warning';
  return 'status-success';
};

function OtaProgressView({ phase, progress }) {
  const getOtaPhaseText = p => {
    switch (p) {
      case 1:
        return 'Updating Display firmware';
      case 2:
        return 'Updating Display filesystem';
      case 3:
        return 'Updating controller firmware';
      default:
        return 'Finished';
    }
  };

  return (
    <div className='flex flex-col items-center gap-4 py-12'>
      <Spinner size={8} />
      <span className='text-base-content text-xl font-medium'>{getOtaPhaseText(phase)}</span>
      <span className='text-base-content text-lg font-medium'>{phase === 4 ? 100 : progress}%</span>
      {phase === 4 && (
        <a href='/' className='btn btn-primary'>
          Back
        </a>
      )}
    </div>
  );
}

function StorageAndMemorySection({ formData }) {
  return (
    <Section title='Storage & Memory'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-3'>
        {formData.spiffsTotal !== undefined && (
          <div className='flex flex-col space-y-2'>
            <span className='text-base-content/70 text-sm font-medium'>Storage (LittleFS)</span>
            <div className='bg-base-300 h-3 w-full overflow-hidden rounded'>
              <div
                className='bg-primary h-full transition-all'
                style={{ width: `${formData.spiffsUsedPct || 0}%` }}
              />
            </div>
            <div className='text-base-content/60 text-xs'>
              {((formData.spiffsUsed || 0) / 1024).toFixed(1)} KB /{' '}
              {(formData.spiffsTotal / 1024).toFixed(1)} KB ({formData.spiffsUsedPct}%)
            </div>
          </div>
        )}

        {formData.sdTotal !== undefined && (
          <div className='flex flex-col space-y-2'>
            <span className='text-base-content/70 text-sm font-medium'>Storage (SD-Card)</span>
            <div className='bg-base-300 h-3 w-full overflow-hidden rounded'>
              <div
                className='bg-primary h-full transition-all'
                style={{ width: `${formData.sdUsedPct || 0}%` }}
              />
            </div>
            <div className='text-base-content/60 text-xs'>
              {((formData.sdUsed || 0) / 1024 / 1024).toFixed(1)} MB /{' '}
              {(formData.sdTotal / 1024 / 1024).toFixed(1)} MB ({formData.sdUsedPct}%)
            </div>
          </div>
        )}

        {formData.heapTotal !== undefined && (
          <div className='flex flex-col space-y-2'>
            <span className='text-base-content/70 text-sm font-medium'>Free Memory (Heap)</span>
            <div className='bg-base-300 h-3 w-full overflow-hidden rounded'>
              <div
                className='bg-primary h-full transition-all'
                style={{
                  width: `${formData.heapTotal > 0 ? ((formData.heapTotal - formData.heapFree) / formData.heapTotal) * 100 : 0}%`,
                }}
              />
            </div>
            <div className='text-base-content/60 text-xs'>
              {((formData.heapTotal - formData.heapFree || 0) / 1024).toFixed(1)} kB /{' '}
              {(formData.heapTotal / 1024).toFixed(1)} kB (
              {(formData.heapTotal > 0
                ? ((formData.heapTotal - formData.heapFree) / formData.heapTotal) * 100
                : 0
              ).toFixed(2)}
              %) (Frag:{' '}
              {(formData.heapFree > 0
                ? 100 - (formData.heapLargest * 100) / formData.heapFree
                : 0
              ).toFixed(2)}
              %)
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function MaintenanceSection({
  downloadSupportData,
  onHistoryRebuild,
  rebuilding,
  rebuilt,
  rebuildProgress,
}) {
  return (
    <Section title='Maintenance & Support'>
      <div className='flex flex-col flex-wrap gap-4 sm:flex-row'>
        <button type='button' className='btn btn-outline btn-sm' onClick={downloadSupportData}>
          Download Support Data
        </button>

        <button
          type='button'
          className='btn btn-outline btn-sm'
          onClick={onHistoryRebuild}
          disabled={rebuilding}
        >
          Rebuild Shot History
          {rebuilding && (
            <>
              <Spinner size={4} className='ml-2' />
              {rebuildProgress.total > 0 && (
                <span className='ml-2 text-xs'>
                  {rebuildProgress.current}/{rebuildProgress.total}
                </span>
              )}
            </>
          )}
          {rebuilt && (
            <span className='text-success ml-2'>
              <FontAwesomeIcon icon={faCheck}></FontAwesomeIcon>
            </span>
          )}
        </button>
      </div>

      {rebuilding && (
        <div className='mt-4 max-w-md'>
          <div className='text-base-content/70 mb-1 text-xs'>
            {rebuildProgress.status === 'starting' ||
            rebuildProgress.status === 'scanning' ||
            rebuildProgress.total === 0
              ? 'Scanning shot history files...'
              : `Processing shot history files (${rebuildProgress.current}/${rebuildProgress.total})`}
          </div>
          <div className='bg-base-300 h-2 w-full overflow-hidden rounded'>
            <div
              className={`h-full transition-all duration-300 ${
                rebuildProgress.total === 0 ? 'bg-primary animate-pulse' : 'bg-primary'
              }`}
              style={{
                width:
                  rebuildProgress.total > 0
                    ? `${(rebuildProgress.current / rebuildProgress.total) * 100}%`
                    : '30%',
              }}
            />
          </div>
        </div>
      )}
    </Section>
  );
}

export function SystemTab() {
  const apiService = useContext(ApiServiceContext);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({});
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const rssi = machine.value.status.rssi;
  const lat = machine.value.status.lat;

  const downloadSupportData = useCallback(async () => {
    try {
      const settingsResponse = await fetch(`/api/settings`);
      const data = await settingsResponse.json();
      delete data.wifiPassword;
      delete data.haPassword;
      const coredumpBlob = await fetch(`/api/core-dump`).then(r => r.blob());
      let coredump = await imageUrlToBase64(coredumpBlob);
      coredump = coredump.substring(coredump.indexOf('base64,') + 7);
      const supportFile = {
        settings: data,
        versions: formData,
        coredump,
      };
      const ts = Date.now();
      downloadJson(supportFile, `support-${ts}.dat`);
    } catch (e) {
      console.error('Error downloading support data:', e);
    }
  }, [formData]);

  useEffect(() => {
    const listenerId = apiService.on('res:ota-settings', msg => {
      setFormData(msg);
      setIsLoading(false);
    });
    return () => {
      apiService.off('res:ota-settings', listenerId);
    };
  }, [apiService]);

  useEffect(() => {
    const listenerId = apiService.on('evt:ota-progress', msg => {
      setProgress(msg.progress);
      setPhase(msg.phase);
    });
    return () => {
      apiService.off('evt:ota-progress', listenerId);
    };
  }, [apiService]);

  useEffect(() => {
    const listenerId = apiService.on('evt:history-rebuild-progress', msg => {
      setRebuildProgress({
        total: msg.total || 0,
        current: msg.current || 0,
        status: msg.status || '',
      });

      if (msg.status === 'completed' || msg.status === 'error') {
        setRebuilding(false);
        setRebuilt(msg.status === 'completed');
      }
    });
    return () => {
      apiService.off('evt:history-rebuild-progress', listenerId);
    };
  }, [apiService]);

  useEffect(() => {
    setTimeout(() => {
      apiService.send({ tp: 'req:ota-settings' });
    }, 500);
  }, [apiService]);

  const [rebuilding, setRebuilding] = useState(false);
  const [rebuilt, setRebuilt] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState({ total: 0, current: 0, status: '' });

  const onHistoryRebuild = useCallback(async () => {
    setRebuilt(false);
    setRebuilding(true);
    setRebuildProgress({ total: 0, current: 0, status: 'starting' });
    apiService.send({ tp: 'req:history:rebuild' });
  }, [apiService]);

  if (phase > 0) {
    return <OtaProgressView phase={phase} progress={progress} />;
  }

  if (isLoading) {
    return <SystemTabSkeleton />;
  }

  return (
    <div className='space-y-4 sm:space-y-6'>
      {/* Backup & flashing (user 2026-09-24). The 16 MB layout has one app slot, so
          firmware can't be uploaded over Wi-Fi: the machine hands out images and
          flashing is done over USB. Replaces the old manual firmware upload. */}
      {/* target='_top' on the downloads: the app's router took them as page links (empty page) */}
      <Section title='Backup & Flashing'>
        <div className='flex flex-wrap items-center gap-2'>
          <a className='btn btn-primary btn-sm' href='/api/backup/full' download target='_top'>
            Download full backup
          </a>
          <a className='btn btn-sm' href='/api/backup/factory' download target='_top'>
            Download new-board file
          </a>
        </div>
        <ul className='text-base-content/70 mt-3 list-disc space-y-1 pl-5 text-sm'>
          <li>
            Full backup: everything (firmware, settings, profiles, shots, pictures), about 16 MB.
            Restores this machine or makes an exact copy on another board. It contains your Wi-Fi
            password, so keep it private. Not while a shot is running.
          </li>
          <li>
            New-board file: firmware only, about 4 MB, with empty settings and no Wi-Fi details in
            it. A new board opens its own &quot;DeLongezzi&quot; hotspot, password <b>espresso-setup</b>:
            join it, open http://4.4.4.1, enter your Wi-Fi under Settings › Wi-Fi and press Save,
            and it restarts into your Wi-Fi.
          </li>
          <li>
            To flash either file, plug the board in by USB and write it at address 0x0 with esptool,
            or with Espressif&apos;s esptool web page in Chrome.
          </li>
        </ul>
      </Section>
      {/* Versions. This build has one app slot and the firmware blocks
          req:ota-start, so there is nothing to update over Wi-Fi: the channel
          picker, "update available" notes and greyed-out Update buttons are gone
          (user 2026-09-24). */}
      <Section title='System Version'>
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          <div className='flex flex-col space-y-1'>
            <span className='text-base-content/70 text-sm font-medium'>Hardware</span>
            <span className='text-base-content font-semibold'>{formData.hardware}</span>
          </div>

          <div className='flex flex-col space-y-1'>
            <span className='text-base-content/70 text-sm font-medium'>
              Controller Signal Strength
            </span>
            <span className='text-base-content flex items-center gap-2 font-semibold'>
              {rssi}dB (Roundtrip: {lat} ms)
              <span className={`indicator-item status ${getRssiStatusClass(rssi)}`} />
            </span>
          </div>

          <div className='flex flex-col space-y-1'>
            <span className='text-base-content/70 text-sm font-medium'>Controller Version</span>
            <span className='text-base-content font-semibold break-all'>
              {formData.controllerVersion}
            </span>
          </div>

          <div className='flex flex-col space-y-1'>
            <span className='text-base-content/70 text-sm font-medium'>Display Version</span>
            <span className='text-base-content font-semibold break-all'>
              {formData.displayVersion}
            </span>
          </div>
        </div>

        <p className='text-base-content/70 mt-6 text-sm'>
          This build updates over USB only: see Backup &amp; Flashing above.
        </p>
      </Section>

      <StorageAndMemorySection formData={formData} />

      <MaintenanceSection
        downloadSupportData={downloadSupportData}
        onHistoryRebuild={onHistoryRebuild}
        rebuilding={rebuilding}
        rebuilt={rebuilt}
        rebuildProgress={rebuildProgress}
      />
    </div>
  );
}
