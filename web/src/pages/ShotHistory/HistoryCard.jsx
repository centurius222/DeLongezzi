import Card from '../../components/Card.jsx';
import { useCallback, useState, useContext } from 'preact/hooks';
import { HistoryChart } from './HistoryChart.jsx';
import { downloadJson } from '../../utils/download.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExport } from '@fortawesome/free-solid-svg-icons/faFileExport';
import { faTrashCan } from '@fortawesome/free-solid-svg-icons/faTrashCan';
import { faWeightScale } from '@fortawesome/free-solid-svg-icons/faWeightScale';
import { faClock } from '@fortawesome/free-solid-svg-icons/faClock';
import { faUpload } from '@fortawesome/free-solid-svg-icons/faUpload';
import { faStar } from '@fortawesome/free-solid-svg-icons/faStar';
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { faMinus } from '@fortawesome/free-solid-svg-icons/faMinus';
import { faMagnifyingGlassChart } from '@fortawesome/free-solid-svg-icons/faMagnifyingGlassChart';
import ShotNotesCard from './ShotNotesCard.jsx';
import { useConfirmAction } from '../../hooks/useConfirmAction.js';

import VisualizerUploadModal from '../../components/VisualizerUploadModal.jsx';
import { visualizerService } from '../../services/VisualizerService.js';
import { ApiServiceContext } from '../../services/ApiService.js';
import { Tooltip } from '../../components/Tooltip.jsx';
import { parseBinaryShot } from './parseBinaryShot.js';
import { shotToProfile, notesToDescription } from './shotToProfile.js';

function round2(v) {
  if (v == null || Number.isNaN(v)) return v;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export default function HistoryCard({ shot, onDelete, onLoad, onRenamed }) {
  const apiService = useContext(ApiServiceContext);
  const [shotNotes, setShotNotes] = useState(shot.notes || null);
  const [expanded, setExpanded] = useState(false);
  const { armed: confirmDelete, armOrRun: confirmOrDelete } = useConfirmAction(4000);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const date = new Date(shot.timestamp * 1000);

  const onExport = useCallback(() => {
    if (!shot.loaded) return; // Only export loaded data
    const exportData = { ...shot, notes: shotNotes };
    if (Array.isArray(exportData.samples)) {
      exportData.samples = exportData.samples.map(s => ({
        t: s.t,
        tt: round2(s.tt),
        ct: round2(s.ct),
        tp: round2(s.tp),
        cp: round2(s.cp),
        fl: round2(s.fl),
        tf: round2(s.tf),
        pf: round2(s.pf),
        vf: round2(s.vf),
        v: round2(s.v),
        ev: round2(s.ev),
        pr: round2(s.pr),
        systemInfo: s.systemInfo,
        phaseNumber: s.phaseNumber,
        phaseDisplayNumber: s.phaseDisplayNumber,
      }));
    }
    exportData.volume = round2(exportData.volume);
    // duration left as integer ms
    downloadJson(exportData, 'shot-' + shot.id + '.json');
  }, [shot, shotNotes]);

  const handleNotesLoaded = useCallback(notes => {
    setShotNotes(notes);
  }, []);

  const profileTitle = shot.profile || 'Unknown Profile';
  let formattedDate = 'No timestamp available';
  if (date.getFullYear() > 1970) {
    formattedDate =
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const handleUpload = useCallback(
    async (username, password, rememberCredentials) => {
      setIsUploading(true);
      try {
        // Validate shot data
        if (!visualizerService.validateShot(shot)) {
          throw new Error('Shot data is invalid or incomplete');
        }

        // Fetch profile data if profileId is available
        let profileData = null;
        if (shot.profileId && apiService) {
          try {
            const profileResponse = await apiService.request({
              tp: 'req:profiles:load',
              id: shot.profileId,
            });
            if (profileResponse.profile) {
              profileData = profileResponse.profile;
            }
          } catch (error) {
            console.warn('Failed to fetch profile data:', error);
            // Continue without profile data
          }
        }

        // Include notes in shot data
        const shotWithNotes = {
          ...shot,
          notes: shotNotes,
        };

        await visualizerService.uploadShot(shotWithNotes, username, password, profileData);

        // Show success message
        alert('Shot uploaded successfully to visualizer.coffee!');
      } catch (error) {
        console.error('Upload failed:', error);
        alert(`Upload failed: ${error.message}`);
        throw error; // Re-throw to prevent modal from closing
      } finally {
        setIsUploading(false);
      }
    },
    [shot, shotNotes, apiService],
  );

  const canUpload = visualizerService.validateShot(shot);

  // "Save as profile": the title turns into a name box; Enter (or Save) stores the profile
  // and renames the shot to it.
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [draftNotes, setDraftNotes] = useState(null); // what's typed in Shot Notes, kept by Save as profile
  const startNaming = () => {
    setNameDraft(shot.profile && shot.profile !== 'Manual' ? shot.profile : '');
    setProfileMsg('');
    setNaming(true);
  };
  // A machine that doesn't answer (just restarted, Wi-Fi drop) used to leave the request hanging
  // and the Save button disabled until a reload.
  const ask = (msg, ms = 10000) =>
    Promise.race([
      apiService.request(msg),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('no answer from the machine, try again')), ms),
      ),
    ]);
  // The profile this shot was saved as before, if any: the shot points at it and its
  // description starts "From shot #<id>" (a shot from a normal profile points at that one).
  // What the shot's profile link points at: 'own' = the profile this shot was saved as (its
  // description starts "From shot #<id>"), 'other' = a normal profile it ran, 'gone' = no longer
  // in Profiles, null = no link (a Manual shot). Returns { kind, profile }.
  const shotProfileLink = async () => {
    if (!shot.profileId || shot.profileId === 'manual') return { kind: null };
    try {
      const res = await ask({ tp: 'req:profiles:load', id: shot.profileId });
      if (!res?.profile) return { kind: 'gone' };
      const own = String(res.profile.description || '').startsWith(`From shot #${shot.id}`);
      return { kind: own ? 'own' : 'other', profile: res.profile };
    } catch {
      return { kind: 'gone' };
    }
  };
  const findOwnProfile = async () => {
    const link = await shotProfileLink();
    return link.kind === 'own' ? link.profile : null;
  };
  const saveAsProfile = async (ownName = null) => {
    // At most 47 bytes (the shot file and index keep 48 with the end marker), cut on a
    // whole character so é or an emoji never ends up half stored.
    let name = (ownName ?? nameDraft).trim();
    while (new TextEncoder().encode(name).length > 47) name = [...name].slice(0, -1).join('');
    if (!name || profileBusy) return;
    setProfileBusy(true);
    setProfileMsg('');
    try {
      let data = shot;
      if (!shot.loaded || !shot.samples) {
        const resp = await fetch(`/api/history/${String(shot.id).padStart(6, '0')}.slog`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const parsed = parseBinaryShot(await resp.arrayBuffer(), shot.id);
        data = { ...parsed, volume: shot.volume ?? parsed.volume };
      }
      let notes = draftNotes;
      if (notes) {
        // Save as profile is also what keeps the shot's notes.
        const res = await ask({ tp: 'req:history:notes:save', id: shot.id, notes });
        if (res?.error) throw new Error(res.error);
        setShotNotes(notes);
      } else {
        try {
          const res = await ask({ tp: 'req:history:notes:get', id: shot.id });
          notes = res?.notes && Object.keys(res.notes).length ? res.notes : null;
        } catch {
          // no notes: the profile just has none
        }
      }
      // Saved before? A shot already saved as a profile points at it, and that profile's
      // description starts "From shot #<id>". Then saving again UPDATES it (same profile,
      // new name and notes) instead of making a second copy.
      const own = await findOwnProfile();
      const profile = own
        ? { ...own, label: name, description: notesToDescription(shot, notes) }
        : await shotToProfile(data, name, apiService, notes);
      const saved = await ask({ tp: 'req:profiles:save', profile });
      if (saved?.error || !saved?.profile?.id) throw new Error(saved?.error || 'Save failed');
      const renamed = await ask({
        tp: 'req:history:rename',
        id: String(shot.id),
        profileId: saved.profile.id,
        profileName: name,
      }).catch(e => ({ error: e.message }));
      if (renamed?.error) {
        // The profile is saved; only the shot kept its old name. Don't invite a retry
        // (that would make a second copy of the profile).
        setNaming(false);
        setProfileMsg(
          own
            ? 'Profile updated (the shot kept its old name)'
            : 'Saved to Profiles (the shot kept its old name)',
        );
        setExpanded(false); // saved: fold the shot back up
        return;
      }
      const doseOut = parseFloat(notes?.doseOut);
      onRenamed?.(shot.id, saved.profile.id, name, {
        ...(Number(notes?.rating) > 0 ? { rating: Number(notes.rating) } : {}),
        ...(doseOut > 0 ? { volume: doseOut } : {}),
      });
      setNaming(false);
      setProfileMsg(own ? 'Profile updated' : 'Saved to Profiles');
      setExpanded(false); // saved: fold the shot back up
    } catch (e) {
      console.error('Save as profile failed', e);
      setProfileMsg(`Not saved: ${e.message}`);
    } finally {
      setProfileBusy(false);
    }
  };
  const saveProfileButton = size => (
    <button
      type='button'
      className={`btn btn-primary btn-outline ${size}`}
      onClick={async () => {
        // Saved before: update that profile with the current notes, no name to type.
        // No name to type when the shot already has one: saved before (update that profile),
        // or its profile was deleted (make it again under the shot's name). The name box is
        // for Manual shots and for copying a normal profile under a new name.
        setProfileBusy(true);
        const link = await shotProfileLink();
        setProfileBusy(false);
        if (link.kind === 'own') saveAsProfile(link.profile.label);
        else if (link.kind === 'gone' && shot.profile) saveAsProfile(shot.profile);
        else startNaming();
      }}
      disabled={naming || profileBusy}
    >
      Save as profile
    </button>
  );

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !shot.loaded && onLoad) onLoad(shot.id);
  };

  return (
    <Card sm={12} className='[&>.card-body]:p-2'>
      <div className='flex flex-col gap-2'>
        {/* The whole row opens/closes the shot like the plus sign; its buttons and the opened
            chart/notes keep their own clicks, and the highlight skips them too. */}
        <div
          className='[&:not(:has([data-no-toggle]:hover)):hover]:bg-base-content/5 flex flex-row items-start gap-2 rounded-md transition-colors [&:not(:has([data-no-toggle]:hover)):hover]:cursor-pointer [&:not(:has([data-no-toggle]:hover)):hover]:ring-1 [&:not(:has([data-no-toggle]:hover)):hover]:ring-orange-500'
          onClick={e => {
            if (!e.target.closest('button, a, input, textarea, select, label, [data-no-toggle]')) {
              toggleExpanded();
            }
          }}
        >
          <button
            className='border-base-content/20 text-base-content/60 hover:text-base-content hover:bg-base-content/10 hover:border-base-content/40 cursor-pointer rounded-md border p-2 transition-all duration-200'
            onClick={toggleExpanded}
            aria-label={expanded ? 'Collapse shot details' : 'Expand shot details'}
          >
            <FontAwesomeIcon icon={expanded ? faMinus : faPlus} className='h-3 w-3' />
          </button>

          <div className='min-w-0 flex-grow'>
            {/* Header Row */}
            <div className='mb-1 flex flex-row items-start justify-between gap-3'>
              <div className='min-w-0 flex-grow'>
                {naming ? (
                  <div className='flex flex-row flex-wrap items-center gap-2'>
                    <input
                      type='text'
                      className='input input-bordered input-sm w-full max-w-xs'
                      placeholder='Profile name'
                      maxLength={47}
                      value={nameDraft}
                      autoFocus
                      onInput={e => setNameDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveAsProfile();
                        if (e.key === 'Escape') setNaming(false);
                      }}
                    />
                    <button
                      type='button'
                      className='btn btn-primary btn-sm'
                      onClick={() => saveAsProfile()}
                      disabled={!nameDraft.trim() || profileBusy}
                    >
                      {profileBusy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type='button'
                      className='btn btn-ghost btn-sm'
                      onClick={() => setNaming(false)}
                      disabled={profileBusy}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h3 className='text-base-content truncate text-base font-semibold'>
                    {profileTitle}
                    {profileMsg && (
                      <span
                        className={`ml-3 text-sm font-medium ${profileMsg.startsWith('Not') ? 'text-error' : 'text-success'}`}
                      >
                        {profileMsg}
                      </span>
                    )}
                  </h3>
                )}
                <p className='text-base-content/70 text-sm'>
                  #{shot.id} • {formattedDate}
                </p>
                {expanded &&
                  shot.loaded &&
                  shot.samples &&
                  shot.samples.length > 0 &&
                  shot.samples[0].systemInfo && (
                    <p className='text-base-content/60 text-xs italic'>
                      Brewed by{' '}
                      {shot.samples[0].systemInfo.shotStartedVolumetric ? 'Weight' : 'Time'}
                    </p>
                  )}
              </div>

              <div className='flex shrink-0 flex-row items-center gap-2'>
                {shot.incomplete && (
                  <span className='inline-flex items-center rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800'>
                    INCOMPLETE
                  </span>
                )}

                <div className='flex flex-row items-center gap-1'>
                  {saveProfileButton('btn-xs')}
                  <Tooltip content={shot.loaded ? 'Export' : 'Load first'}>
                    <button
                      disabled={!shot.loaded}
                      onClick={onExport}
                      className='text-base-content/50 hover:text-info hover:bg-info/10 cursor-pointer rounded-md p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
                      aria-label='Export shot data'
                    >
                      <FontAwesomeIcon icon={faFileExport} className='h-4 w-4' />
                    </button>
                  </Tooltip>

                  {/* Analyzer Button */}
                  <Tooltip content='Open in Analyzer'>
                    <a
                      href={`/analyzer/internal/${shot.id}`}
                      className='text-base-content/50 hover:text-primary hover:bg-primary/10 flex items-center justify-center rounded-md p-2 transition-colors'
                      aria-label='Open in Analyzer'
                    >
                      <FontAwesomeIcon icon={faMagnifyingGlassChart} className='h-4 w-4' />
                    </a>
                  </Tooltip>

                  <Tooltip
                    content={
                      canUpload
                        ? 'Upload to Visualizer.coffee'
                        : 'Load shot data first by expanding the shot'
                    }
                  >
                    <button
                      onClick={() => setShowUploadModal(true)}
                      disabled={!canUpload}
                      className={`group inline-block cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent px-2.5 py-2 text-sm font-semibold ${
                        canUpload
                          ? 'text-success hover:bg-success/10 active:border-success/20'
                          : 'cursor-not-allowed text-gray-400'
                      }`}
                      aria-label='Upload to visualizer.coffee'
                    >
                      <FontAwesomeIcon icon={faUpload} />
                    </button>
                  </Tooltip>
                  <Tooltip content={confirmDelete ? 'Click to confirm delete' : 'Delete'}>
                    <button
                      onClick={() => {
                        confirmOrDelete(() => onDelete(shot.id));
                      }}
                      className={`cursor-pointer rounded-md p-2 transition-colors ${confirmDelete ? 'bg-error text-error-content font-semibold' : 'text-base-content/50 hover:text-error hover:bg-error/10'}`}
                      aria-label={confirmDelete ? 'Confirm deletion of shot' : 'Delete shot'}
                    >
                      <FontAwesomeIcon icon={faTrashCan} className='h-4 w-4' />
                      {confirmDelete && <span className='ml-2 hidden sm:inline'>Confirm</span>}
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Stats Row */}
            <div className='text-base-content/80 mb-1 flex flex-row items-center gap-4 text-sm'>
              <div className='flex items-center gap-1'>
                <FontAwesomeIcon icon={faClock} className='h-4 w-4' />
                <span>{(shot.duration / 1000).toFixed(1)}s</span>
              </div>

              {shot.volume && shot.volume > 0 && (
                <div className='flex items-center gap-1'>
                  <FontAwesomeIcon icon={faWeightScale} className='h-4 w-4' />
                  <span>{round2(shot.volume)}g</span>
                </div>
              )}

              {shot.rating && shot.rating > 0 ? (
                <div className='flex items-center gap-1'>
                  <FontAwesomeIcon icon={faStar} className='h-4 w-4 text-yellow-500' />
                  <span className='font-medium'>{shot.rating}/5</span>
                </div>
              ) : (
                <div className='text-base-content/50 flex items-center gap-1'>
                  <FontAwesomeIcon icon={faStar} className='h-4 w-4' />
                  <span>Not rated</span>
                </div>
              )}
            </div>

            {expanded && (
              <div data-no-toggle className='border-base-content/20 mt-4 cursor-auto border-t pt-4'>
                {!shot.loaded && (
                  <div className='flex flex-col items-center justify-center gap-3 py-8'>
                    {shot.loadError ? (
                      <>
                        <span className='text-error text-sm'>
                          Couldn't load this shot: {shot.loadError}
                        </span>
                        <button
                          type='button'
                          className='btn btn-sm btn-outline'
                          onClick={() => onLoad?.(shot.id)}
                        >
                          Retry
                        </button>
                      </>
                    ) : (
                      <span className='text-base-content/70 text-sm'>Loading shot data...</span>
                    )}
                  </div>
                )}
                {shot.loaded && <HistoryChart shot={shot} />}
                {shot.loaded && (
                  <ShotNotesCard
                    shot={shot}
                    onNotesLoaded={handleNotesLoaded}
                    onNotesEdit={setDraftNotes}
                  />
                )}
                {/* At the bottom, after the notes it saves. */}
                {shot.loaded && (
                  <div className='mt-4 flex justify-center'>{saveProfileButton('btn-md')}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <VisualizerUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUpload={handleUpload}
        isUploading={isUploading}
        shotInfo={{
          profile: shot.profile,
          timestamp: shot.timestamp,
          duration: shot.duration,
          volume: shot.volume,
        }}
      />
    </Card>
  );
}
