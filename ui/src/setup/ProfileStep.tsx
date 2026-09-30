import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { AutoAwesome as AutoAwesomeIcon, Refresh as RefreshIcon, Save as SaveIcon } from '@mui/icons-material';
import { ApiError, errMsg, getJSON, pollJob, postJSON, putJSON } from '../api';
import { Profile, ProfileBundle } from '../types';
import { LogBox, MONO, panelSx } from './common';
import ProfileForm, { normalizeProfile } from './ProfileForm';

type Draft = { profile: Profile | null; facts: string; voice: string; skills: string };
type DocKey = 'facts' | 'voice' | 'skills';

const EMPTY_BUNDLE: ProfileBundle = { profile: null, facts: '', voice: '', skills: '', recommendations: '' };

const DOC_TABS: { key: DocKey; label: string; hint: string }[] = [
  { key: 'facts', label: 'Facts', hint: 'Canonical career facts. Every claim and number in a tailored resume must trace back to this file.' },
  { key: 'voice', label: 'Voice', hint: 'How your resumes should sound: tone, phrasing, and words to avoid.' },
  { key: 'skills', label: 'Skills', hint: 'Skills index: capabilities, each with the evidence behind it.' },
];

export default function ProfileStep({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const [bundle, setBundle] = useState<ProfileBundle | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [tab, setTab] = useState(0);

  const apply = (b: ProfileBundle) => {
    setBundle(b);
    setDraft({
      profile: b.profile ? normalizeProfile(b.profile) : null,
      facts: b.facts ?? '',
      voice: b.voice ?? '',
      skills: b.skills ?? '',
    });
    setDirty(false);
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      apply((await getJSON<ProfileBundle>('/api/profile')) ?? EMPTY_BUNDLE);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) apply(EMPTY_BUNDLE);
      else setLoadError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const ready = !!bundle?.profile && !dirty && !building;
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const build = async () => {
    setConfirmRebuild(false);
    setBuilding(true);
    setBuildError(null);
    setSaveError(null);
    setBuildLog([]);
    try {
      const { job_id } = await postJSON<{ job_id: string }>('/api/setup/build-profile');
      const job = await pollJob<ProfileBundle>(job_id, setBuildLog);
      if (job.status === 'done') {
        if (job.result) apply(job.result);
        else await load();
        setTab(0);
      } else {
        setBuildError((job.error || 'Profile build failed without a message.').slice(-3000));
      }
    } catch (err) {
      setBuildError(errMsg(err));
    } finally {
      setBuilding(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: Partial<ProfileBundle> = { facts: draft.facts, voice: draft.voice, skills: draft.skills };
      if (draft.profile) body.profile = draft.profile;
      apply(await putJSON<ProfileBundle>('/api/profile', body));
    } catch (err) {
      setSaveError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  if (loading) return <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box>;

  const hasContent = !!draft && (!!draft.profile || !!draft.facts || !!draft.voice || !!draft.skills);
  const wizard = Boolean(onReadyChange);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {loadError && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
          Couldn't load your profile: {loadError}
        </Alert>
      )}
      {buildError && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap', fontFamily: MONO, fontSize: 12 }}>{buildError}</Alert>}

      {building ? (
        <Paper elevation={0} sx={{ ...panelSx, textAlign: 'center', py: 5 }}>
          <CircularProgress size={48} />
          <Typography variant="h6" sx={{ mt: 2.5 }}>Drafting your profile...</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 2.5 }}>
            Reading your uploads and notes, then writing profile.json, facts.md, voice.md, and skills.md. A few minutes is normal.
          </Typography>
          <Box sx={{ maxWidth: 860, mx: 'auto' }}><LogBox lines={buildLog} /></Box>
        </Paper>
      ) : !hasContent ? (
        <Paper elevation={0} sx={{ ...panelSx, textAlign: 'center', py: 5 }}>
          <AutoAwesomeIcon sx={{ fontSize: 44, color: '#14B8A6' }} />
          <Typography variant="h6" sx={{ mt: 1.5 }}>Draft your profile</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 3, maxWidth: 620, mx: 'auto' }}>
            The orient model reads everything you shared and drafts your search profile, fact inventory, writing voice, and skills index. You review and edit every part before anything runs.
          </Typography>
          <Button variant="contained" size="large" startIcon={<AutoAwesomeIcon />} onClick={build} disabled={!!loadError}>
            Build my profile
          </Button>
        </Paper>
      ) : (
        draft && (
          <>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />} onClick={save} disabled={saving || !dirty}>
                Save
              </Button>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => setConfirmRebuild(true)} disabled={saving}>
                Rebuild
              </Button>
              <Chip
                size="small"
                label={dirty ? 'Unsaved changes' : 'Saved'}
                sx={{ bgcolor: dirty ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)', color: dirty ? '#FBBF24' : '#34D399' }}
              />
              {wizard && dirty && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Save your edits to finish.</Typography>
              )}
            </Box>
            {saveError && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{saveError}</Alert>}

            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: '1px solid #1F2937' }}>
              <Tab label="Profile" />
              {DOC_TABS.map((d) => <Tab key={d.key} label={d.label} />)}
            </Tabs>

            {tab === 0 &&
              (draft.profile ? (
                <ProfileForm value={draft.profile} onChange={(p) => update({ profile: p })} />
              ) : (
                <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => update({ profile: normalizeProfile(null) })}>Start blank</Button>}>
                  No profile.json yet. Rebuild to draft one, or start from a blank form.
                </Alert>
              ))}

            {DOC_TABS.map((d, i) =>
              tab === i + 1 ? (
                <Box key={d.key}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>{d.hint}</Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={22}
                    value={draft[d.key]}
                    onChange={(e) => update({ [d.key]: e.target.value })}
                    InputProps={{ sx: { fontFamily: MONO, fontSize: 13, lineHeight: 1.55 } }}
                    sx={{ bgcolor: '#0B0F19' }}
                  />
                </Box>
              ) : null,
            )}
          </>
        )
      )}

      <Dialog open={confirmRebuild} onClose={() => setConfirmRebuild(false)} PaperProps={{ sx: { bgcolor: '#111827', border: '1px solid #1F2937' } }}>
        <DialogTitle>Rebuild your profile?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            This re-reads your uploads and notes and overwrites profile.json, facts.md, voice.md, and skills.md. The server keeps a backup of the current files.
            {dirty ? ' Your unsaved edits here will be lost.' : ''}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRebuild(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={build}>Rebuild</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
